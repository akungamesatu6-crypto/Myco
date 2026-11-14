// SPDX-License-Identifier: MIT
// MYCO — BSC BEP-721, 3,333 mushroom forest spirits.
// Spec (user-confirmed 2026-11-13, main chat):
//   Supply 3,333, SEQUENTIAL mint (id = totalMinted + 1). No rarity
//   tiers: 33 kinds, 101 spirits per kind — kind index = (id-1)/101.
//   Kinds (id ranges): Moss 1-101 / Amanita 102-202 / Glowcap 203-303 /
//   Chanterelle 304-404 / Morel 405-505 / Inkcap 506-606 / Coral 607-707 /
//   Enoki 708-808 / Porcini 809-909 / Oyster 910-1010 / Shiitake 1011-1111 /
//   Truffle 1112-1212 / Lion's Mane 1213-1313 / Reishi 1314-1414 /
//   Chaga 1415-1515 / Blewit 1516-1616 / Matsutake 1617-1717 /
//   Cauliflower 1718-1818 / Hedgehog 1819-1919 / Lobster 1920-2020 /
//   Parasol 2021-2121 / Saffron 2122-2222 / Honey Cap 2223-2323 /
//   Yellowfoot 2324-2424 / Bluefoot 2425-2525 / Pinkgill 2526-2626 /
//   Wood Ear 2627-2727 / Jelly 2728-2828 / Puffball 2829-2929 /
//   Shaggy Mane 2930-3030 / Maitake 3031-3131 / Witch's Butter 3132-3232 /
//   Fairy Ring 3233-3333.
//   MINT (launch order user-confirmed 2026-11-13):
//   1. Free — FREE #1, Agent ID ONLY, NO allowlist (v2, redeployed
//      2026-11-14 at user order "Open free mint buat myco tanpa
//      whitelist": the v1 contract gated mintFree behind an allowlist
//      with no toggle, so a new NFT contract was deployed. One free
//      per wallet.
//   2. Presale — 0.0005 BNB each, Agent ID ONLY, max 5 paid per wallet.
//      Opens together with Tweet to Mint at 12:00 UTC, Nov 13 2026.
//   3. Public — 0.001 BNB each, Agent ID ONLY, same max 5 paid/wallet.
//      Owner flips publicOpen when the presale phase ends.
//   Max 6/wallet total (1 free + 5 paid). Per-transaction mint cap 5.
//   GATE (page FAQ): Agent ID (SPACE ID registry balance > 0) is required
//   for the free first mint AND for paid mints (msg.sender == tx.origin).
//   $MYCO is NOT paid per mint — it is earned after mint via the Mining /
//   Burn / Node scheme contracts (separate deploys, later).
//   Mint money: forwarded to the owner (project wallet) in the same tx;
//   the contract does not hold mint revenue.
//   Royalty 5% (ERC-2981, standing default — NOT separately confirmed).
//   Owner can ONLY: open/close mint, flip the public phase,
//   set base URI, withdraw stuck funds.
//   Prices, supply and limits are immutable after deploy.
//   baseURI: https://myco-one.vercel.app/metadata/
//   Language: English + Japanese + Chinese (page only).
//   Official X: https://x.com/mycowner
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAgentID {
    function balanceOf(address) external view returns (uint256);
}

/// @title MYCO
contract MycoNft is ERC721, ERC2981, Ownable, ReentrancyGuard {
    IAgentID public immutable AGENT_ID;

    uint256 public constant MAX_SUPPLY = 3333;
    uint256 public constant KINDS = 33;
    uint256 public constant PER_KIND = 101; // 33 x 101 = 3,333
    uint256 public constant MAX_PER_WALLET = 6; // 1 free + 5 paid
    uint256 public constant FREE_PER_WALLET = 1;
    uint256 public constant MAX_PAID_PER_WALLET = 5;
    uint256 public constant MAX_PER_TX = 5;
    uint256 public constant PRICE_PRESALE = 0.0005 ether;
    uint256 public constant PRICE_PUBLIC = 0.001 ether;

    uint256 public totalMinted;
    uint256 public paidMinted;
    uint256 public freeMinted;
    bool public mintOpen;
    bool public publicOpen; // false = presale phase, true = public phase
    string private _base;

    mapping(address => uint256) public mintedOf;
    mapping(address => uint256) public freeMintedOf;
    mapping(address => uint256) public paidMintedOf;

    event Minted(address indexed minter, uint256 indexed id, bool paid, uint256 priceWei);

    error NotAgent();
    error MintClosed();
    error SoldOut();
    error OverLimit();
    error Underpaid(uint256 required);
    error FreeClaimed();

    constructor(
        string memory baseURI_,
        address owner_,
        address agentId_
    ) ERC721("MYCO", "MYCO") Ownable(owner_) {
        _base = baseURI_;
        AGENT_ID = IAgentID(agentId_);
        mintOpen = false; // mint starts CLOSED until owner opens it
        publicOpen = false; // presale phase first
        _setDefaultRoyalty(owner_, 500); // 5%
    }

    modifier onlyAgent() {
        if (msg.sender != tx.origin || AGENT_ID.balanceOf(msg.sender) == 0) revert NotAgent();
        if (!mintOpen) revert MintClosed();
        _;
    }

    /// @notice Current paid price per mint (presale 0.0005, public 0.001).
    function currentPrice() public view returns (uint256) {
        return publicOpen ? PRICE_PUBLIC : PRICE_PRESALE;
    }

    /// @notice BNB cost for `qty` further PAID mints by `wallet`.
    function quotePaidFor(address wallet, uint256 qty) public view returns (uint256) {
        if (qty == 0 || qty > MAX_PER_TX) revert OverLimit();
        if (paidMintedOf[wallet] + qty > MAX_PAID_PER_WALLET) revert OverLimit();
        if (mintedOf[wallet] + qty > MAX_PER_WALLET) revert OverLimit();
        if (totalMinted + qty > MAX_SUPPLY) revert SoldOut();
        return qty * currentPrice();
    }

    /// @notice Kind index 0-32 for a token id (Moss=0 ... Fairy Ring=32).
    function kindIndex(uint256 id) public pure returns (uint256) {
        require(id >= 1 && id <= MAX_SUPPLY, "bad id");
        return (id - 1) / PER_KIND;
    }

    /// @notice Kind name for a token id.
    function kindOf(uint256 id) public pure returns (string memory) {
        uint256 k = kindIndex(id);
        if (k == 0) return "Moss";
        if (k == 1) return "Amanita";
        if (k == 2) return "Glowcap";
        if (k == 3) return "Chanterelle";
        if (k == 4) return "Morel";
        if (k == 5) return "Inkcap";
        if (k == 6) return "Coral";
        if (k == 7) return "Enoki";
        if (k == 8) return "Porcini";
        if (k == 9) return "Oyster";
        if (k == 10) return "Shiitake";
        if (k == 11) return "Truffle";
        if (k == 12) return "Lion's Mane";
        if (k == 13) return "Reishi";
        if (k == 14) return "Chaga";
        if (k == 15) return "Blewit";
        if (k == 16) return "Matsutake";
        if (k == 17) return "Cauliflower";
        if (k == 18) return "Hedgehog";
        if (k == 19) return "Lobster";
        if (k == 20) return "Parasol";
        if (k == 21) return "Saffron";
        if (k == 22) return "Honey Cap";
        if (k == 23) return "Yellowfoot";
        if (k == 24) return "Bluefoot";
        if (k == 25) return "Pinkgill";
        if (k == 26) return "Wood Ear";
        if (k == 27) return "Jelly";
        if (k == 28) return "Puffball";
        if (k == 29) return "Shaggy Mane";
        if (k == 30) return "Maitake";
        if (k == 31) return "Witch's Butter";
        return "Fairy Ring"; // 32
    }

    /// @notice Number of this spirit within its kind (1-101).
    function kindNumber(uint256 id) public pure returns (uint256) {
        uint256 k = kindIndex(id);
        return id - k * PER_KIND;
    }

    function totalSupply() external view returns (uint256) {
        return totalMinted;
    }

    function exists(uint256 id) external view returns (bool) {
        return _ownerOf(id) != address(0);
    }

    /// @notice FREE lane: the wallet's one free spirit.
    /// Agent ID ONLY, no allowlist. No payment.
    function mintFree() external nonReentrant onlyAgent {
        if (freeMintedOf[msg.sender] >= FREE_PER_WALLET) revert FreeClaimed();
        if (totalMinted + 1 > MAX_SUPPLY) revert SoldOut();
        uint256 id = totalMinted + 1;
        totalMinted++;
        freeMinted++;
        freeMintedOf[msg.sender]++;
        mintedOf[msg.sender]++;
        _safeMint(msg.sender, id);
        emit Minted(msg.sender, id, false, 0);
    }

    /// @notice PAID lane: mint `qty` spirits at the current phase price.
    /// Agent ID ONLY. Presale 0.0005 BNB while publicOpen is false,
    /// public 0.001 BNB after the owner flips it.
    function mintPaid(uint256 qty) external payable nonReentrant onlyAgent {
        if (qty == 0 || qty > MAX_PER_TX) revert OverLimit();
        if (paidMintedOf[msg.sender] + qty > MAX_PAID_PER_WALLET) revert OverLimit();
        if (mintedOf[msg.sender] + qty > MAX_PER_WALLET) revert OverLimit();
        if (totalMinted + qty > MAX_SUPPLY) revert SoldOut();
        uint256 cost = quotePaidFor(msg.sender, qty);
        if (msg.value < cost) revert Underpaid(cost);

        uint256 price = currentPrice();
        for (uint256 i; i < qty; i++) {
            uint256 id = totalMinted + 1;
            totalMinted++;
            paidMinted++;
            _safeMint(msg.sender, id);
            emit Minted(msg.sender, id, true, price);
        }
        paidMintedOf[msg.sender] += qty;
        mintedOf[msg.sender] += qty;

        // Mint money goes straight to the project wallet.
        if (cost > 0) {
            (bool ok, ) = owner().call{value: cost}("");
            require(ok, "forward");
        }
        if (msg.value > cost) {
            (bool ok, ) = msg.sender.call{value: msg.value - cost}("");
            require(ok, "refund");
        }
    }

    /// @notice tokenURI returns the metadata file immediately, from mint time.
    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        return string.concat(_base, Strings.toString(id));
    }

    // ── owner: only these switches exist ──
    function setMintOpen(bool v) external onlyOwner {
        mintOpen = v;
    }

    function setPublicOpen(bool v) external onlyOwner {
        publicOpen = v;
    }

    function setBaseURI(string calldata b) external onlyOwner {
        _base = b;
    }

    function withdraw() external onlyOwner nonReentrant {
        (bool ok, ) = owner().call{value: address(this).balance}("");
        require(ok, "withdraw");
    }

    function supportsInterface(bytes4 i) public view override(ERC721, ERC2981) returns (bool) {
        return super.supportsInterface(i);
    }
}
