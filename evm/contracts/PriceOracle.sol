// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./Governable.sol";

/**
 * @title PriceOracle
 * @dev Provides real-time price feeds for various assets used as collateral
 * @notice This contract aggregates price data from multiple sources for accurate valuation
 * @notice Governable (part b2): the oracle set and the staleness window are protocol parameters
 *         and are reachable by governance proposal. Governable extends Ownable, so the owner
 *         keeps every power it had; onlyGovernance widens a function, it never narrows one.
 *         addAsset and removeAsset stay onlyOwner on purpose. Listing an asset commits the
 *         protocol to valuing collateral it may not have a real feed for, which is a risk
 *         decision with the same shape as authorizing a settlement token, not a parameter.
 */
contract PriceOracle is Governable, ReentrancyGuard {
    
    // Price data structure
    struct PriceData {
        uint256 price;           // Price in USD (scaled by 1e8)
        uint256 timestamp;       // Last update timestamp
        uint256 confidence;      // Confidence level (0-100)
        bool isValid;           // Whether the price is valid
    }
    
    // Asset information
    struct AssetInfo {
        string symbol;          // Asset symbol (e.g., "ETH", "BTC")
        uint8 decimals;         // Asset decimals
        bool isSupported;       // Whether the asset is supported
        uint256 maxPriceAge;    // Maximum age for price data (seconds)
    }
    
    // Price feeds mapping
    mapping(address => PriceData) public priceFeeds;
    mapping(address => AssetInfo) public assetInfo;
    mapping(address => bool) public authorizedOracles;
    
    // Supported assets
    address[] public supportedAssets;
    
    // Events
    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp, uint256 confidence);
    event AssetAdded(address indexed asset, string symbol, uint8 decimals);
    event AssetRemoved(address indexed asset);
    event OracleAuthorized(address indexed oracle);
    event OracleDeauthorized(address indexed oracle);
    event MaxPriceAgeUpdated(address indexed asset, uint256 maxAge);
    
    // Errors
    error UnsupportedAsset();
    error InvalidPrice();
    error StalePrice();
    error UnauthorizedOracle();
    error InvalidConfidence();
    
    constructor() Ownable(msg.sender) {
        // Initialize with common assets
        _addAsset(address(0), "ETH", 18, 300); // ETH (address(0) represents native ETH)
        _addAsset(address(0x1), "BTC", 8, 300); // BTC placeholder
        _addAsset(address(0x2), "USDC", 6, 60); // USDC placeholder
        _addAsset(address(0x3), "USDT", 6, 60); // USDT placeholder
        
        // Authorize the deployer as the initial oracle
        authorizedOracles[msg.sender] = true;
        emit OracleAuthorized(msg.sender);
        
        // Set initial placeholder prices (for demo purposes)
        _setInitialPrices();
    }
    
    /**
     * @dev Set initial placeholder prices for demo assets
     */
    function _setInitialPrices() internal {
        // ETH price: $2000 (scaled by 1e8)
        priceFeeds[address(0)] = PriceData({
            price: 2000 * 1e8,
            timestamp: block.timestamp,
            confidence: 95,
            isValid: true
        });
        
        // BTC price: $30000 (scaled by 1e8)
        priceFeeds[address(0x1)] = PriceData({
            price: 30000 * 1e8,
            timestamp: block.timestamp,
            confidence: 95,
            isValid: true
        });
        
        // USDC price: $1 (scaled by 1e8)
        priceFeeds[address(0x2)] = PriceData({
            price: 1 * 1e8,
            timestamp: block.timestamp,
            confidence: 99,
            isValid: true
        });
        
        // USDT price: $1 (scaled by 1e8)
        priceFeeds[address(0x3)] = PriceData({
            price: 1 * 1e8,
            timestamp: block.timestamp,
            confidence: 99,
            isValid: true
        });
    }
    
    /**
     * @dev Update price for an asset
     * @param asset Asset address (address(0) for native ETH)
     * @param price Price in USD (scaled by 1e8)
     * @param confidence Confidence level (0-100)
     */
    function updatePrice(address asset, uint256 price, uint256 confidence) external {
        require(authorizedOracles[msg.sender], "Unauthorized oracle");
        require(assetInfo[asset].isSupported, "Unsupported asset");
        require(price > 0, "Invalid price");
        require(confidence <= 100, "Invalid confidence");
        
        priceFeeds[asset] = PriceData({
            price: price,
            timestamp: block.timestamp,
            confidence: confidence,
            isValid: true
        });
        
        emit PriceUpdated(asset, price, block.timestamp, confidence);
    }
    
    /**
     * @dev Batch update prices for multiple assets
     * @param assets Array of asset addresses
     * @param prices Array of prices
     * @param confidences Array of confidence levels
     */
    function batchUpdatePrices(
        address[] calldata assets,
        uint256[] calldata prices,
        uint256[] calldata confidences
    ) external {
        require(authorizedOracles[msg.sender], "Unauthorized oracle");
        require(assets.length == prices.length && prices.length == confidences.length, "Array length mismatch");
        
        for (uint256 i = 0; i < assets.length; i++) {
            require(assetInfo[assets[i]].isSupported, "Unsupported asset");
            require(prices[i] > 0, "Invalid price");
            require(confidences[i] <= 100, "Invalid confidence");
            
            priceFeeds[assets[i]] = PriceData({
                price: prices[i],
                timestamp: block.timestamp,
                confidence: confidences[i],
                isValid: true
            });
            
            emit PriceUpdated(assets[i], prices[i], block.timestamp, confidences[i]);
        }
    }
    
    /**
     * @dev Get current price for an asset
     * @param asset Asset address
     * @return price Current price in USD (scaled by 1e8)
     */
    function getPrice(address asset) external view returns (uint256 price) {
        if (!assetInfo[asset].isSupported) revert UnsupportedAsset();
        
        PriceData memory data = priceFeeds[asset];
        if (!data.isValid) revert InvalidPrice();
        
        // Check if price is stale
        if (block.timestamp - data.timestamp > assetInfo[asset].maxPriceAge) {
            revert StalePrice();
        }
        
        return data.price;
    }
    
    /**
     * @dev Get price with confidence level
     * @param asset Asset address
     * @return price Current price in USD (scaled by 1e8)
     * @return confidence Confidence level (0-100)
     * @return timestamp Last update timestamp
     */
    function getPriceWithConfidence(address asset) external view returns (
        uint256 price,
        uint256 confidence,
        uint256 timestamp
    ) {
        if (!assetInfo[asset].isSupported) revert UnsupportedAsset();
        
        PriceData memory data = priceFeeds[asset];
        if (!data.isValid) revert InvalidPrice();
        
        // Check if price is stale
        if (block.timestamp - data.timestamp > assetInfo[asset].maxPriceAge) {
            revert StalePrice();
        }
        
        return (data.price, data.confidence, data.timestamp);
    }
    
    /**
     * @dev Calculate USD value of an asset amount
     * @param asset Asset address
     * @param amount Amount of asset (in asset's native decimals)
     * @return value USD value (scaled by 1e8)
     */
    function getUSDValue(address asset, uint256 amount) external view returns (uint256 value) {
        uint256 price = this.getPrice(asset);
        uint8 decimals = assetInfo[asset].decimals;
        
        // Convert amount to 18 decimals, then multiply by price
        if (decimals <= 18) {
            value = (amount * price) / (10 ** decimals);
        } else {
            value = (amount * price) / (10 ** decimals);
        }
    }
    
    /**
     * @dev Get all supported assets
     * @return assets Array of supported asset addresses
     */
    function getSupportedAssets() external view returns (address[] memory assets) {
        return supportedAssets;
    }
    
    /**
     * @dev Check if an asset is supported
     * @param asset Asset address
     * @return supported Whether the asset is supported
     */
    function isAssetSupported(address asset) external view returns (bool supported) {
        return assetInfo[asset].isSupported;
    }
    
    /**
     * @dev Add a new supported asset
     * @param asset Asset address
     * @param symbol Asset symbol
     * @param decimals Asset decimals
     * @param maxPriceAge Maximum age for price data
     */
    function addAsset(address asset, string calldata symbol, uint8 decimals, uint256 maxPriceAge) external onlyOwner {
        _addAsset(asset, symbol, decimals, maxPriceAge);
    }
    
    /**
     * @dev Remove a supported asset
     * @param asset Asset address
     */
    function removeAsset(address asset) external onlyOwner {
        require(assetInfo[asset].isSupported, "Asset not supported");
        
        assetInfo[asset].isSupported = false;
        priceFeeds[asset].isValid = false;
        
        // Remove from supported assets array
        for (uint256 i = 0; i < supportedAssets.length; i++) {
            if (supportedAssets[i] == asset) {
                supportedAssets[i] = supportedAssets[supportedAssets.length - 1];
                supportedAssets.pop();
                break;
            }
        }
        
        emit AssetRemoved(asset);
    }
    
    /**
     * @dev Authorize an oracle
     * @param oracle Oracle address
     */
    function authorizeOracle(address oracle) external onlyOwner {
        _setOracleAuthorized(oracle, true);
    }

    /**
     * @dev Deauthorize an oracle
     * @param oracle Oracle address
     */
    function deauthorizeOracle(address oracle) external onlyOwner {
        _setOracleAuthorized(oracle, false);
    }

    /**
     * @dev Authorize or deauthorize an oracle in one call
     * @notice The governable form of the pair above, and the only one the dispatch table can
     *         reach. Two functions cannot share a ParameterType, and splitting authorize and
     *         deauthorize across two enum entries would double the enum to say one thing. The
     *         boolean is in the calldata a voter reads, which is where the direction belongs.
     *         The legacy single-purpose pair stays exactly as it was: same names, same ABI, same
     *         events, still owner-only, so anything built against them keeps working.
     * @param oracle Oracle address
     * @param authorized Whether the oracle may push prices
     */
    function setOracleAuthorized(address oracle, bool authorized) external onlyGovernance {
        _setOracleAuthorized(oracle, authorized);
    }

    /**
     * @dev Shared write path, so the owner-only pair and the governable setter cannot drift
     * @notice Emits the same OracleAuthorized / OracleDeauthorized events either way. An indexer
     *         following the oracle set does not need to learn that governance exists.
     */
    function _setOracleAuthorized(address oracle, bool authorized) internal {
        authorizedOracles[oracle] = authorized;
        if (authorized) {
            emit OracleAuthorized(oracle);
        } else {
            emit OracleDeauthorized(oracle);
        }
    }

    /**
     * @dev Update maximum price age for an asset
     * @notice Widened from onlyOwner to onlyGovernance. The staleness window is the protocol's
     *         tolerance for an old price, which is exactly the kind of number a token holder has
     *         a legitimate opinion about, and the timelock is the right speed for changing it.
     * @param asset Asset address
     * @param maxAge Maximum age in seconds
     */
    function updateMaxPriceAge(address asset, uint256 maxAge) external onlyGovernance {
        require(assetInfo[asset].isSupported, "Asset not supported");
        assetInfo[asset].maxPriceAge = maxAge;
        emit MaxPriceAgeUpdated(asset, maxAge);
    }
    
    /**
     * @dev Internal function to add an asset
     */
    function _addAsset(address asset, string memory symbol, uint8 decimals, uint256 maxPriceAge) internal {
        require(!assetInfo[asset].isSupported, "Asset already supported");
        
        assetInfo[asset] = AssetInfo({
            symbol: symbol,
            decimals: decimals,
            isSupported: true,
            maxPriceAge: maxPriceAge
        });
        
        supportedAssets.push(asset);
        
        emit AssetAdded(asset, symbol, decimals);
    }
    
    /**
     * @dev Get asset information
     * @param asset Asset address
     * @return info Asset information struct
     */
    function getAssetInfo(address asset) external view returns (AssetInfo memory info) {
        return assetInfo[asset];
    }
    
    /**
     * @dev Get price data for an asset
     * @param asset Asset address
     * @return data Price data struct
     */
    function getPriceData(address asset) external view returns (PriceData memory data) {
        return priceFeeds[asset];
    }
    
    /**
     * @dev Check if an oracle is authorized
     * @param oracle Oracle address
     * @return authorized Whether the oracle is authorized
     */
    function isOracleAuthorized(address oracle) external view returns (bool authorized) {
        return authorizedOracles[oracle];
    }
}
