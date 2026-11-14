const { expect } = require("chai");
const { ethers } = require("hardhat");

const BASE_URI = "https://myco-one.vercel.app/metadata/";
const BAW = "0x36F3D56eAD5D1D6C2434F94DeFcEF732C5C3CbD2";
const E = ethers.parseEther;

describe("MYCO", function () {
  let token, nft, market, owner, agent, agent2, stranger, agentIdMock;

  before(async function () {
    [owner, agent, agent2, stranger] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("MockAgentID");
    agentIdMock = await Mock.deploy();
    await agentIdMock.mint(agent.address);
    await agentIdMock.mint(agent2.address);

    const Token = await ethers.getContractFactory("MycoToken");
    token = await Token.deploy(owner.address);
    const NFT = await ethers.getContractFactory("MycoNft");
    nft = await NFT.deploy(BASE_URI, owner.address, await agentIdMock.getAddress());
    const Market = await ethers.getContractFactory("MycoMarketplace");
    market = await Market.deploy(await nft.getAddress());
    await nft.setMintOpen(true);
  });

  it("constructor: name/symbol/supply/limits/royalty 5%, mint starts closed", async function () {
    expect(await nft.name()).to.equal("MYCO");
    expect(await nft.symbol()).to.equal("MYCO");
    expect(await nft.MAX_SUPPLY()).to.equal(3333);
    expect(await nft.MAX_PER_WALLET()).to.equal(6);
    expect(await nft.FREE_PER_WALLET()).to.equal(1);
    expect(await nft.MAX_PAID_PER_WALLET()).to.equal(5);
    expect(await nft.publicOpen()).to.equal(false);
    const [receiver, amount] = await nft.royaltyInfo(1, 10000);
    expect(receiver).to.equal(owner.address);
    expect(amount).to.equal(500); // 5%
  });

  it("kindOf / kindIndex / kindNumber: 33 kinds x 101", async function () {
    expect(await nft.kindOf(1)).to.equal("Moss");
    expect(await nft.kindIndex(1)).to.equal(0);
    expect(await nft.kindNumber(1)).to.equal(1);
    expect(await nft.kindOf(101)).to.equal("Moss");
    expect(await nft.kindNumber(101)).to.equal(101);
    expect(await nft.kindOf(102)).to.equal("Amanita");
    expect(await nft.kindIndex(102)).to.equal(1);
    expect(await nft.kindNumber(102)).to.equal(1);
    expect(await nft.kindOf(202)).to.equal("Amanita");
    expect(await nft.kindOf(203)).to.equal("Glowcap");
    expect(await nft.kindOf(3233)).to.equal("Fairy Ring");
    expect(await nft.kindIndex(3233)).to.equal(32);
    expect(await nft.kindOf(3333)).to.equal("Fairy Ring");
    expect(await nft.kindNumber(3333)).to.equal(101);
    expect(await nft.kindOf(2223)).to.equal("Honey Cap");
    expect(await nft.kindOf(2930)).to.equal("Shaggy Mane");
  });

  it("prices: presale 0.0005, public 0.001 after flip", async function () {
    expect(await nft.currentPrice()).to.equal(E("0.0005"));
    expect(await nft.quotePaidFor(agent.address, 5)).to.equal(E("0.0025"));
    await nft.setPublicOpen(true);
    expect(await nft.currentPrice()).to.equal(E("0.001"));
    expect(await nft.quotePaidFor(agent.address, 5)).to.equal(E("0.005"));
    await nft.setPublicOpen(false); // back to presale for the mint tests
    expect(await nft.currentPrice()).to.equal(E("0.0005"));
  });

  it("mintFree: closed / non-agent revert; any agent mints free (no allowlist)", async function () {
    const NFT = await ethers.getContractFactory("MycoNft");
    const closed = await NFT.deploy(BASE_URI, owner.address, await agentIdMock.getAddress());
    await expect(closed.connect(agent).mintFree()).to.be.revertedWithCustomError(closed, "MintClosed");
    // non-agent (stranger has no Agent ID) on the open contract
    await expect(nft.connect(stranger).mintFree()).to.be.revertedWithCustomError(nft, "NotAgent");
  });

  it("mintFree: agent mints id 1 (Moss), once only", async function () {
    await expect(nft.connect(agent).mintFree())
      .to.emit(nft, "Minted").withArgs(agent.address, 1, false, 0);
    expect(await nft.ownerOf(1)).to.equal(agent.address);
    expect(await nft.kindOf(1)).to.equal("Moss");
    expect(await nft.freeMinted()).to.equal(1);
    expect(await nft.tokenURI(1)).to.equal(BASE_URI + "1");
    await expect(nft.connect(agent).mintFree()).to.be.revertedWithCustomError(nft, "FreeClaimed");
  });

  it("mintPaid: presale 5 @ 0.0005, revenue forwards to owner, limits enforced", async function () {
    const before = await ethers.provider.getBalance(owner.address);
    await expect(nft.connect(agent2).mintPaid(5, { value: E("0.0025") }))
      .to.emit(nft, "Minted").withArgs(agent2.address, 2, true, E("0.0005"));
    expect(await nft.paidMinted()).to.equal(5);
    expect(await nft.ownerOf(6)).to.equal(agent2.address);
    expect(await ethers.provider.getBalance(owner.address) - before).to.equal(E("0.0025"));
    // 6th paid mint exceeds MAX_PAID_PER_WALLET
    await expect(nft.connect(agent2).mintPaid(1, { value: E("0.0005") }))
      .to.be.revertedWithCustomError(nft, "OverLimit");
    // underpaid reverts with the required amount
    await expect(nft.connect(stranger).mintPaid(1, { value: E("0.0001") }))
      .to.be.revertedWithCustomError(nft, "NotAgent"); // stranger has no Agent ID
    await expect(nft.connect(agent).mintPaid(1, { value: E("0.0001") }))
      .to.be.revertedWithCustomError(nft, "Underpaid").withArgs(E("0.0005"));
  });

  it("max per wallet: free 1 + paid 5 = 6, then OverLimit", async function () {
    // agent already has 1 free; mint 5 paid to reach 6 total
    await nft.connect(agent).mintPaid(5, { value: E("0.0025") });
    expect(await nft.mintedOf(agent.address)).to.equal(6);
    await expect(nft.connect(agent).mintPaid(1, { value: E("0.0005") }))
      .to.be.revertedWithCustomError(nft, "OverLimit");
  });

  it("public phase: price flips to 0.001 for a fresh agent", async function () {
    await nft.setPublicOpen(true);
    const [, , , , fresh] = await ethers.getSigners();
    await agentIdMock.mint(fresh.address);
    await nft.connect(fresh).mintPaid(1, { value: E("0.001") });
    expect(await nft.paidMinted()).to.equal(11);
    await nft.setPublicOpen(false);
  });

  it("EOA gate: a contract calling mintFree reverts NotAgent", async function () {
    const Caller = await ethers.getContractFactory("MintCaller");
    const caller = await Caller.deploy();
    await expect(caller.callMintFree(await nft.getAddress())).to.be.revertedWith("call failed");
  });

  it("token: 3,333,000 total, pool 1.8M in contract, treasury 1,533,000 to owner", async function () {
    expect(await token.totalSupply()).to.equal(E("3333000"));
    expect(await token.REWARDS_POOL()).to.equal(E("1800000"));
    expect(await token.balanceOf(await token.getAddress())).to.equal(E("1800000"));
    expect(await token.balanceOf(owner.address)).to.equal(E("1533000"));
  });

  it("token: accrue only by approved minter, pool cap enforced, claim works", async function () {
    await expect(token.connect(agent).accrue(agent.address, E("100")))
      .to.be.revertedWithCustomError(token, "NotMinter");
    await token.setMinter(agent.address, true);
    await token.connect(agent).accrue(agent.address, E("100"));
    expect(await token.claimable(agent.address)).to.equal(E("100"));
    await token.connect(agent).claim();
    expect(await token.balanceOf(agent.address)).to.equal(E("100"));
    expect(await token.claimable(agent.address)).to.equal(0);
    await expect(token.connect(agent).claim()).to.be.revertedWithCustomError(token, "NothingToClaim");
    // pool cap: 1,800,000 total, 100 already accrued
    await expect(token.connect(agent).accrue(agent.address, E("1800000")))
      .to.be.revertedWithCustomError(token, "OverPoolCap");
    await token.setMinter(agent.address, false);
    await expect(token.connect(agent).accrue(agent.address, E("1")))
      .to.be.revertedWithCustomError(token, "NotMinter");
  });

  it("marketplace: list/buy splits 5% royalty to owner, 95% to seller", async function () {
    // agent owns id 1; approve + list at 1 BNB
    await nft.connect(agent).approve(await market.getAddress(), 1);
    await market.connect(agent).list(1, E("1"));
    const ownerBefore = await ethers.provider.getBalance(owner.address);
    const agentBefore = await ethers.provider.getBalance(agent.address);
    await market.connect(stranger).buy(1, { value: E("1") });
    expect(await nft.ownerOf(1)).to.equal(stranger.address);
    expect(await ethers.provider.getBalance(owner.address) - ownerBefore).to.equal(E("0.05"));
    expect(await ethers.provider.getBalance(agent.address) - agentBefore).to.equal(E("0.95"));
  });

  it("marketplace: 5% fallback royalty on an NFT without royalty support", async function () {
    const MockNft = await ethers.getContractFactory("MockERC721NoRoyalty");
    const mockNft = await MockNft.deploy();
    await mockNft.mint(agent.address, 99);
    const Market2 = await ethers.getContractFactory("MycoMarketplace");
    const market2 = await Market2.deploy(await mockNft.getAddress());
    await mockNft.connect(agent).approve(await market2.getAddress(), 99);
    await market2.connect(agent).list(99, E("1"));
    const bawBefore = await ethers.provider.getBalance(BAW);
    await market2.connect(stranger).buy(99, { value: E("1") });
    expect(await mockNft.ownerOf(99)).to.equal(stranger.address);
    expect(await ethers.provider.getBalance(BAW) - bawBefore).to.equal(E("0.05"));
  });

  it("marketplace: cancel returns the NFT to the seller", async function () {
    await nft.connect(agent2).approve(await market.getAddress(), 2);
    await market.connect(agent2).list(2, E("0.5"));
    await market.connect(agent2).cancel(2);
    expect(await nft.ownerOf(2)).to.equal(agent2.address);
    expect((await market.getListing(2))[2]).to.equal(false);
  });
});
