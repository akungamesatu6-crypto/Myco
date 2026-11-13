// MYCO deploy SIMULATION ONLY — no mainnet transaction is sent.
// Computes CREATE2 predicted addresses exactly as the deterministic-proxy
// route did for BNTB/SAKURA/Momo, and measures gas on the local network.
// Deploy order: $MYCO token first (constructor: owner only), then the
// MYCO NFT (constructor: baseURI, owner, Agent ID registry), then the
// marketplace (constructor: predicted NFT address). After deploy the owner
// must call token.setMinter(...) for each scheme contract (Mining / Burn /
// Node) when those deploy later — the NFT does NOT accrue $MYCO.
// Mint stays CLOSED (mintOpen=false, presale phase) until the owner calls
// setMintOpen(true) at 12:00 UTC, Nov 13 2026.
// Model (user-confirmed 2026-11-13): supply 3,333, SEQUENTIAL mint,
// 33 kinds x 101; Tweet to Mint FREE #1 (allowlist + Agent ID);
// Presale 0.0005 BNB (Agent ID, max 5 paid/wallet); public 0.001 BNB
// (Agent ID, owner flips publicOpen); max 6/wallet total. Royalty 5%.
// Token: 3,333,000 total (1,800,000 pool / 1,533,000 treasury).
// Run: npx hardhat run scripts/deploy_simulation.js
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const BASE_URI = "https://myco-one.vercel.app/metadata/";
const OWNER = "0x36F3D56eAD5D1D6C2434F94DeFcEF732C5C3CbD2";
const AGENT_ID = "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F"; // SPACE ID Agent ID registry
const PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C"; // deterministic deployment proxy
const PROXY_CREATION =
  "0x604580600e600039806000f350fe7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

function predict(artifact, argTypes, argValues) {
  const args = ethers.AbiCoder.defaultAbiCoder().encode(argTypes, argValues);
  const creation = artifact.bytecode + args.slice(2);
  const predicted = ethers.getCreate2Address(PROXY, ethers.ZeroHash, ethers.keccak256(creation));
  const inputData = "0x" + "00".repeat(32) + creation.slice(2);
  return { creation, predicted, inputData };
}

async function main() {
  const outDir = path.join(__dirname, "..");

  // --- $MYCO token: predict first (constructor args: owner) ---
  const tokenArtifact = await hre.artifacts.readArtifact("MycoToken");
  const tokenPred = predict(tokenArtifact, ["address"], [OWNER]);

  // --- NFT: predict (constructor args: baseURI, owner, agentId) ---
  const nftArtifact = await hre.artifacts.readArtifact("MycoNft");
  const nftPred = predict(
    nftArtifact,
    ["string", "address", "address"],
    [BASE_URI, OWNER, AGENT_ID]
  );

  // --- Marketplace: predict (constructor args: nft=predicted) ---
  const marketFactory = await ethers.getContractFactory("MycoMarketplace");
  const marketDeployTx = await marketFactory.getDeployTransaction(nftPred.predicted);
  const marketCreation = marketDeployTx.data;
  const marketPredicted = ethers.getCreate2Address(PROXY, ethers.ZeroHash, ethers.keccak256(marketCreation));
  const marketInputData = ethers.hexlify(ethers.concat([ethers.ZeroHash, marketCreation]));

  fs.writeFileSync(path.join(outDir, "token_creation.txt"), tokenPred.creation);
  fs.writeFileSync(path.join(outDir, "token_inputdata.txt"), tokenPred.inputData);
  fs.writeFileSync(path.join(outDir, "token_predicted.txt"), tokenPred.predicted);
  fs.writeFileSync(path.join(outDir, "nft_creation.txt"), nftPred.creation);
  fs.writeFileSync(path.join(outDir, "nft_inputdata.txt"), nftPred.inputData);
  fs.writeFileSync(path.join(outDir, "nft_predicted.txt"), nftPred.predicted);
  fs.writeFileSync(path.join(outDir, "market_creation.txt"), marketCreation);
  fs.writeFileSync(path.join(outDir, "market_inputdata.txt"), marketInputData);
  fs.writeFileSync(path.join(outDir, "market_predicted.txt"), marketPredicted);

  console.log("$MYCO token predicted:", tokenPred.predicted);
  console.log("MYCO NFT predicted:", nftPred.predicted);
  console.log("Marketplace predicted:", marketPredicted);

  // --- Local deploy + gas measurements ---
  const Token = await ethers.getContractFactory("MycoToken");
  const token = await Token.deploy(OWNER);
  const tokenReceipt = await token.deploymentTransaction().wait();
  console.log("token gas:", tokenReceipt.gasUsed.toString());

  const NFT = await ethers.getContractFactory("MycoNft");
  const nft = await NFT.deploy(BASE_URI, OWNER, AGENT_ID);
  const nftReceipt = await nft.deploymentTransaction().wait();
  console.log("nft gas:", nftReceipt.gasUsed.toString());

  const Market = await ethers.getContractFactory("MycoMarketplace");
  const market = await Market.deploy(await nft.getAddress());
  const marketReceipt = await market.deploymentTransaction().wait();
  console.log("market gas:", marketReceipt.gasUsed.toString());

  // --- Sanity checks ---
  console.log("NFT name:", await nft.name(), "symbol:", await nft.symbol());
  console.log("MAX_SUPPLY:", (await nft.MAX_SUPPLY()).toString());
  console.log("royaltyInfo(1, 10000):", await nft.royaltyInfo(1, 10000));
  console.log("currentPrice (presale):", ethers.formatEther(await nft.currentPrice()));
  console.log("quotePaidFor(5):", ethers.formatEther(await nft.quotePaidFor(ethers.ZeroAddress, 5)));
  console.log("kindOf(1):", await nft.kindOf(1), "| kindOf(101):", await nft.kindOf(101), "| kindOf(102):", await nft.kindOf(102), "| kindOf(3333):", await nft.kindOf(3333));
  console.log("token totalSupply:", ethers.formatEther(await token.totalSupply()));
  console.log("token REWARDS_POOL:", ethers.formatEther(await token.REWARDS_POOL()));

  fs.writeFileSync(
    path.join(outDir, "deploy_simulation.json"),
    JSON.stringify(
      {
        token: tokenPred.predicted,
        nft: nftPred.predicted,
        market: marketPredicted,
        tokenGas: tokenReceipt.gasUsed.toString(),
        nftGas: nftReceipt.gasUsed.toString(),
        marketGas: marketReceipt.gasUsed.toString(),
      },
      null,
      2
    )
  );
  console.log("simulation done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
