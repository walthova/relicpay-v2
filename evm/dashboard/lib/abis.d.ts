// GENERATED FILE. Do not edit.
// Regenerate with: npm run abi:export  (after npm run compile)
// Source: build/v2/*.json, produced by tools/compile.js from contracts/*.sol

export declare const relicPayAbi: readonly [
  {
    readonly "inputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "target";
        readonly "type": "address";
      }
    ];
    readonly "name": "AddressEmptyCode";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "AddressInsufficientBalance";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementAlreadyCompleted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementAlreadyDefaulted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementNotActive";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementNotFound";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementTooLong";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "CollateralBacksOpenCredit";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ExceedsWithdrawablePrincipal";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "FailedInnerCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "GracePeriodNotExpired";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientAutoPaymentBalance";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientCollateral";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientCredit";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientPayment";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientSettlementCollateral";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidAgreement";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidCollateralType";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidMaxAgreementDuration";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidNFT";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidPaymentMethod";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidSettlementToken";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidToken";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "OwnershipTransferFailed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "PaymentAlreadyProcessed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "PaymentNotDue";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ReentrancyGuardReentrantCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      }
    ];
    readonly "name": "SafeERC20FailedOperation";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedCaller";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedGovernance";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnexpectedETHPayment";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnsupportedSettlementMethod";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ValueTooLarge";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentCount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "enum RelicPay.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      },
      {
        readonly "components": readonly [
          {
            readonly "internalType": "string";
            readonly "name": "physicalId";
            readonly "type": "string";
          },
          {
            readonly "internalType": "address";
            readonly "name": "nftContract";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "tokenId";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "string";
            readonly "name": "metadataURI";
            readonly "type": "string";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "ownershipTransferred";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "address";
            readonly "name": "currentOwner";
            readonly "type": "address";
          }
        ];
        readonly "indexed": false;
        readonly "internalType": "struct RelicPay.RWAAsset";
        readonly "name": "rwaAsset";
        readonly "type": "tuple";
      }
    ];
    readonly "name": "AgreementCreated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "missedInstallment";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "outstanding";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "collateralSeized";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AgreementDefaulted";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "enabled";
        readonly "type": "bool";
      }
    ];
    readonly "name": "AutoPaymentEnabled";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "newBalance";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AutoPaymentTokensDeposited";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "newBalance";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AutoPaymentTokensWithdrawn";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "enum RelicPay.CollateralType";
        readonly "name": "collateralType";
        readonly "type": "uint8";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CollateralDeposited";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CollateralSeized";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "positionId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CollateralWithdrawn";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "availableCredit";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "usedCredit";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CreditLineUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "creditLimitRatio";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "defaultGracePeriod";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "minCollateralAmount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "GovernanceUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousGovernor";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newGovernor";
        readonly "type": "address";
      }
    ];
    readonly "name": "GovernorUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "oldValue";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "newValue";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "MaxAgreementDurationUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "nftContract";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "enum RelicPay.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "autoProcessed";
        readonly "type": "bool";
      }
    ];
    readonly "name": "PaymentProcessed";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "dueDate";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "PaymentScheduled";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOracle";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "PriceOracleUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "ethBalance";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalBalance";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "SellerBalanceUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "isETH";
        readonly "type": "bool";
      }
    ];
    readonly "name": "SellerWithdrawal";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "SettlementCredited";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      }
    ];
    readonly "name": "SettlementPreferenceUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "name": "SettlementTokenAuthorized";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "yieldAmount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalYield";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "YieldAccrued";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MAX_CREDIT_UTILIZATION";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "agreementSettlementToken";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "agreements";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "installmentCount";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "startTime";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "paidInstallments";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "gracePeriodSeconds";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "enum RelicPay.BnplState";
        readonly "name": "state";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "enum RelicPay.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "autoPaymentEnabled";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "lastPaymentTime";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "collateralPositionId";
        readonly "type": "bytes32";
      },
      {
        readonly "components": readonly [
          {
            readonly "internalType": "string";
            readonly "name": "physicalId";
            readonly "type": "string";
          },
          {
            readonly "internalType": "address";
            readonly "name": "nftContract";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "tokenId";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "string";
            readonly "name": "metadataURI";
            readonly "type": "string";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "ownershipTransferred";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "address";
            readonly "name": "currentOwner";
            readonly "type": "address";
          }
        ];
        readonly "internalType": "struct RelicPay.RWAAsset";
        readonly "name": "rwaAsset";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "nftAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "name": "authorizeNFT";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "name": "authorizeSettlementToken";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "name": "authorizeToken";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "authorizedNFTs";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "authorizedTokens";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "autoPaymentBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "autoPaymentEnabled";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "autoPaymentTokenBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "collateralPositions";
    readonly "outputs": readonly [
      {
        readonly "internalType": "enum RelicPay.CollateralType";
        readonly "name": "collateralType";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "autoReinvest";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "lastUpdateTime";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "yieldAccrued";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "stakingRewards";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "collateralPrincipal";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "collateralSeized";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentCount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "gracePeriodSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "enum RelicPay.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      },
      {
        readonly "components": readonly [
          {
            readonly "internalType": "string";
            readonly "name": "physicalId";
            readonly "type": "string";
          },
          {
            readonly "internalType": "address";
            readonly "name": "nftContract";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "tokenId";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "string";
            readonly "name": "metadataURI";
            readonly "type": "string";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "ownershipTransferred";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "address";
            readonly "name": "currentOwner";
            readonly "type": "address";
          }
        ];
        readonly "internalType": "struct RelicPay.RWAAsset";
        readonly "name": "rwaAsset";
        readonly "type": "tuple";
      }
    ];
    readonly "name": "createAgreementWithRWA";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "creditLines";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "collateralValue";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "availableCredit";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "usedCredit";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint16";
        readonly "name": "creditUtilization";
        readonly "type": "uint16";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "lastUpdateTime";
        readonly "type": "uint40";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "defaultedAt";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "depositAutoPaymentFunds";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "depositAutoPaymentTokens";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "depositERC20Collateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "stakeForYield";
        readonly "type": "bool";
      }
    ];
    readonly "name": "depositETHCollateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getAgreement";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "address";
            readonly "name": "seller";
            readonly "type": "address";
          },
          {
            readonly "internalType": "address";
            readonly "name": "buyer";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "totalPrice";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "installmentAmount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "installmentCount";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "dueIntervalSeconds";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "startTime";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "paidInstallments";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "gracePeriodSeconds";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "enum RelicPay.BnplState";
            readonly "name": "state";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "enum RelicPay.PaymentMethod";
            readonly "name": "paymentMethod";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "autoPaymentEnabled";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "lastPaymentTime";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "bytes32";
            readonly "name": "collateralPositionId";
            readonly "type": "bytes32";
          },
          {
            readonly "components": readonly [
              {
                readonly "internalType": "string";
                readonly "name": "physicalId";
                readonly "type": "string";
              },
              {
                readonly "internalType": "address";
                readonly "name": "nftContract";
                readonly "type": "address";
              },
              {
                readonly "internalType": "uint256";
                readonly "name": "tokenId";
                readonly "type": "uint256";
              },
              {
                readonly "internalType": "string";
                readonly "name": "metadataURI";
                readonly "type": "string";
              },
              {
                readonly "internalType": "bool";
                readonly "name": "ownershipTransferred";
                readonly "type": "bool";
              },
              {
                readonly "internalType": "address";
                readonly "name": "currentOwner";
                readonly "type": "address";
              }
            ];
            readonly "internalType": "struct RelicPay.RWAAsset";
            readonly "name": "rwaAsset";
            readonly "type": "tuple";
          }
        ];
        readonly "internalType": "struct RelicPay.BnplAgreement";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "getAutoPaymentBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "positionId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getCollateralPosition";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "enum RelicPay.CollateralType";
            readonly "name": "collateralType";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "address";
            readonly "name": "tokenAddress";
            readonly "type": "address";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "autoReinvest";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "lastUpdateTime";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "amount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "yieldAccrued";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "stakingRewards";
            readonly "type": "uint256";
          }
        ];
        readonly "internalType": "struct RelicPay.CollateralPosition";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getCollateralSeized";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getCreditLine";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "uint256";
            readonly "name": "collateralValue";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "creditLimit";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "availableCredit";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "usedCredit";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint16";
            readonly "name": "creditUtilization";
            readonly "type": "uint16";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "lastUpdateTime";
            readonly "type": "uint40";
          }
        ];
        readonly "internalType": "struct RelicPay.CreditLine";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getDefaultStatus";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "defaultable";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "nextInstallment";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "graceExpiry";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "outstanding";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "getGovernanceParams";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "uint256";
            readonly "name": "creditLimitRatio";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "defaultGracePeriod";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "minCollateralAmount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "maxAgreementDuration";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "autoPaymentEnabled";
            readonly "type": "bool";
          }
        ];
        readonly "internalType": "struct RelicPay.GovernanceParams";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getPaymentSchedule";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "uint256";
            readonly "name": "installmentNumber";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "amount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "dueDate";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "enum RelicPay.PaymentStatus";
            readonly "name": "status";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "paidAmount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "paidAt";
            readonly "type": "uint256";
          }
        ];
        readonly "internalType": "struct RelicPay.PaymentSchedule[]";
        readonly "name": "";
        readonly "type": "tuple[]";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      }
    ];
    readonly "name": "getSellerBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "getSellerTokenBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "getSettlementCollateral";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getSettlementReadiness";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "required";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "autoBalance";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "collateralAvailable";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "ready";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getSettlementTerms";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "nextInstallment";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "requiresApproval";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getSettlementToken";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getTotalCollateralValue";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getUserCollateralPositionIds";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32[]";
        readonly "name": "";
        readonly "type": "bytes32[]";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "positionId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getWithdrawableCollateral";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "governanceParams";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "creditLimitRatio";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "defaultGracePeriod";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "minCollateralAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "maxAgreementDuration";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "autoPaymentEnabled";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "governor";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "hasGovernanceRights";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bytes";
        readonly "name": "";
        readonly "type": "bytes";
      }
    ];
    readonly "name": "onERC721Received";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes4";
        readonly "name": "";
        readonly "type": "bytes4";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "paymentSchedules";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "dueDate";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "enum RelicPay.PaymentStatus";
        readonly "name": "status";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "paidAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "paidAt";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "priceOracle";
    readonly "outputs": readonly [
      {
        readonly "internalType": "contract IRelicPayPriceOracle";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "processOverduePayments";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "processPayment";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "sellerBalances";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "sellerSettlementToken";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "sellerTokenBalances";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "enabled";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setAutoPayment";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_creditLimitRatio";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setCreditLimitRatio";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_defaultGracePeriod";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setDefaultGracePeriod";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newGovernor";
        readonly "type": "address";
      }
    ];
    readonly "name": "setGovernor";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_maxAgreementDuration";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setMaxAgreementDuration";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_minCollateralAmount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setMinCollateralAmount";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "setPriceOracle";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "setSettlementPreference";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "rateBasisPoints";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setYieldRate";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "settlementTokens";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "totalPaid";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "triggerDefault";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_creditLimitRatio";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "_defaultGracePeriod";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "_minCollateralAmount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "updateGovernanceParams";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "userCollateralPositionIds";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "userNonces";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "withdrawAutoPaymentFunds";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "withdrawAutoPaymentTokens";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "positionId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "withdrawCollateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "withdrawSellerBalance";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "withdrawSellerTokenBalance";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "yieldRates";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  }
];

export declare const relicRegistryAbi: readonly [
  {
    readonly "inputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "DuplicatePhysicalId";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "sender";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "ERC721IncorrectOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "operator";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ERC721InsufficientApproval";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "approver";
        readonly "type": "address";
      }
    ];
    readonly "name": "ERC721InvalidApprover";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "operator";
        readonly "type": "address";
      }
    ];
    readonly "name": "ERC721InvalidOperator";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "ERC721InvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "receiver";
        readonly "type": "address";
      }
    ];
    readonly "name": "ERC721InvalidReceiver";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "sender";
        readonly "type": "address";
      }
    ];
    readonly "name": "ERC721InvalidSender";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ERC721NonexistentToken";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "NotIssuer";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "approved";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "Approval";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "operator";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "approved";
        readonly "type": "bool";
      }
    ];
    readonly "name": "ApprovalForAll";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "_fromTokenId";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "_toTokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "BatchMetadataUpdate";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "issuer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "allowed";
        readonly "type": "bool";
      }
    ];
    readonly "name": "IssuerSet";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "_tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "MetadataUpdate";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "issuer";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "string";
        readonly "name": "physicalId";
        readonly "type": "string";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "string";
        readonly "name": "uri";
        readonly "type": "string";
      }
    ];
    readonly "name": "RelicMinted";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "from";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "Transfer";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "approve";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "balanceOf";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getApproved";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getRelic";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "string";
            readonly "name": "physicalId";
            readonly "type": "string";
          },
          {
            readonly "internalType": "address";
            readonly "name": "issuer";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint64";
            readonly "name": "mintedAt";
            readonly "type": "uint64";
          }
        ];
        readonly "internalType": "struct RelicRegistry.Relic";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "operator";
        readonly "type": "address";
      }
    ];
    readonly "name": "isApprovedForAll";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "issuers";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "internalType": "string";
        readonly "name": "physicalId";
        readonly "type": "string";
      },
      {
        readonly "internalType": "string";
        readonly "name": "uri";
        readonly "type": "string";
      }
    ];
    readonly "name": "mintRelic";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "name";
    readonly "outputs": readonly [
      {
        readonly "internalType": "string";
        readonly "name": "";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "nextId";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ownerOf";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "from";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "safeTransferFrom";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "from";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bytes";
        readonly "name": "data";
        readonly "type": "bytes";
      }
    ];
    readonly "name": "safeTransferFrom";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "operator";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "approved";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setApprovalForAll";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "issuer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "allowed";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setIssuer";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes4";
        readonly "name": "interfaceId";
        readonly "type": "bytes4";
      }
    ];
    readonly "name": "supportsInterface";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "symbol";
    readonly "outputs": readonly [
      {
        readonly "internalType": "string";
        readonly "name": "";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "tokenByPhysicalId";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "tokenURI";
    readonly "outputs": readonly [
      {
        readonly "internalType": "string";
        readonly "name": "";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "from";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "to";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "tokenId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "transferFrom";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  }
];

export declare const priceOracleAbi: readonly [
  {
    readonly "inputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidConfidence";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidPrice";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ReentrancyGuardReentrantCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "StalePrice";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedGovernance";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedOracle";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnsupportedAsset";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "string";
        readonly "name": "symbol";
        readonly "type": "string";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint8";
        readonly "name": "decimals";
        readonly "type": "uint8";
      }
    ];
    readonly "name": "AssetAdded";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "AssetRemoved";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousGovernor";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newGovernor";
        readonly "type": "address";
      }
    ];
    readonly "name": "GovernorUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "maxAge";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "MaxPriceAgeUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "OracleAuthorized";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "OracleDeauthorized";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "timestamp";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "confidence";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "PriceUpdated";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "internalType": "string";
        readonly "name": "symbol";
        readonly "type": "string";
      },
      {
        readonly "internalType": "uint8";
        readonly "name": "decimals";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "maxPriceAge";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "addAsset";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "assetInfo";
    readonly "outputs": readonly [
      {
        readonly "internalType": "string";
        readonly "name": "symbol";
        readonly "type": "string";
      },
      {
        readonly "internalType": "uint8";
        readonly "name": "decimals";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "isSupported";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "maxPriceAge";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "authorizeOracle";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "authorizedOracles";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address[]";
        readonly "name": "assets";
        readonly "type": "address[]";
      },
      {
        readonly "internalType": "uint256[]";
        readonly "name": "prices";
        readonly "type": "uint256[]";
      },
      {
        readonly "internalType": "uint256[]";
        readonly "name": "confidences";
        readonly "type": "uint256[]";
      }
    ];
    readonly "name": "batchUpdatePrices";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "deauthorizeOracle";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "getAssetInfo";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "string";
            readonly "name": "symbol";
            readonly "type": "string";
          },
          {
            readonly "internalType": "uint8";
            readonly "name": "decimals";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "isSupported";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "maxPriceAge";
            readonly "type": "uint256";
          }
        ];
        readonly "internalType": "struct PriceOracle.AssetInfo";
        readonly "name": "info";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "getPrice";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "getPriceData";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "uint256";
            readonly "name": "price";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "timestamp";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "confidence";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "isValid";
            readonly "type": "bool";
          }
        ];
        readonly "internalType": "struct PriceOracle.PriceData";
        readonly "name": "data";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "getPriceWithConfidence";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "confidence";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "timestamp";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "getSupportedAssets";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address[]";
        readonly "name": "assets";
        readonly "type": "address[]";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getUSDValue";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "value";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "governor";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "hasGovernanceRights";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "isAssetSupported";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "supported";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      }
    ];
    readonly "name": "isOracleAuthorized";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "priceFeeds";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "timestamp";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "confidence";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "isValid";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "removeAsset";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newGovernor";
        readonly "type": "address";
      }
    ];
    readonly "name": "setGovernor";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "oracle";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setOracleAuthorized";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "supportedAssets";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "maxAge";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "updateMaxPriceAge";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "confidence";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "updatePrice";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  }
];

export declare const chainlinkPriceAdapterAbi: readonly [
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "sink";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AggregatorCallFailed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AssetNotSupportedBySink";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "FeedAnswerInvalid";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "FeedNotSet";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "FeedRoundIncomplete";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "FeedStale";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidAggregator";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidConfidence";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidFeedAge";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidGracePeriod";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidSink";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "NoAssets";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "SequencerCheckFailed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "SequencerDown";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "SequencerGracePeriodNotOver";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "SequencerRoundInvalid";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "aggregator";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint8";
        readonly "name": "feedDecimals";
        readonly "type": "uint8";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint32";
        readonly "name": "maxFeedAge";
        readonly "type": "uint32";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint8";
        readonly "name": "confidence";
        readonly "type": "uint8";
      }
    ];
    readonly "name": "FeedRegistered";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "aggregator";
        readonly "type": "address";
      }
    ];
    readonly "name": "FeedRemoved";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "feedUpdatedAt";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint80";
        readonly "name": "roundId";
        readonly "type": "uint80";
      }
    ];
    readonly "name": "PricePushed";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "string";
        readonly "name": "reason";
        readonly "type": "string";
      }
    ];
    readonly "name": "PushSkipped";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "feed";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint32";
        readonly "name": "gracePeriod";
        readonly "type": "uint32";
      }
    ];
    readonly "name": "SequencerFeedSet";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MAX_FEED_AGE_LIMIT";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint32";
        readonly "name": "";
        readonly "type": "uint32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MAX_SEQUENCER_GRACE_PERIOD";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint32";
        readonly "name": "";
        readonly "type": "uint32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MIN_SEQUENCER_GRACE_PERIOD";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint32";
        readonly "name": "";
        readonly "type": "uint32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ORACLE_DECIMALS";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint8";
        readonly "name": "";
        readonly "type": "uint8";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "getFeed";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "address";
            readonly "name": "aggregator";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint8";
            readonly "name": "feedDecimals";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "maxFeedAge";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint8";
            readonly "name": "confidence";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "isSet";
            readonly "type": "bool";
          }
        ];
        readonly "internalType": "struct ChainlinkPriceAdapter.Feed";
        readonly "name": "feed";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "getRegisteredAssets";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address[]";
        readonly "name": "assets";
        readonly "type": "address[]";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "hasFeed";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "peekFeed";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "ok";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "feedUpdatedAt";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "string";
        readonly "name": "reason";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "priceOracle";
    readonly "outputs": readonly [
      {
        readonly "internalType": "contract IPriceOracleSink";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "pushAll";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "pushed";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "pushPrice";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address[]";
        readonly "name": "assets";
        readonly "type": "address[]";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "skipUnhealthy";
        readonly "type": "bool";
      }
    ];
    readonly "name": "pushPrices";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "pushed";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "readFeed";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "price";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "feedUpdatedAt";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint80";
        readonly "name": "roundId";
        readonly "type": "uint80";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      }
    ];
    readonly "name": "removeFeed";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "sequencerGracePeriod";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint32";
        readonly "name": "";
        readonly "type": "uint32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "sequencerStatus";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "ok";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "string";
        readonly "name": "reason";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "sequencerUptimeFeed";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "aggregator";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "maxFeedAge";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint8";
        readonly "name": "confidence";
        readonly "type": "uint8";
      }
    ];
    readonly "name": "setFeed";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "feed";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "gracePeriod";
        readonly "type": "uint32";
      }
    ];
    readonly "name": "setSequencerUptimeFeed";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  }
];

export declare const deFiIntegrationAbi: readonly [
  {
    readonly "inputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidProtocolUpdate";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ReentrancyGuardReentrantCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedGovernance";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ValueTooLarge";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousGovernor";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newGovernor";
        readonly "type": "address";
      }
    ];
    readonly "name": "GovernorUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "apy";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ProtocolAuthorized";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      }
    ];
    readonly "name": "ProtocolDeauthorized";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "YieldClaimed";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "yield";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "YieldPositionClosed";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "shares";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "YieldPositionCreated";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AAVE_V3_POOL";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "COMPOUND_ETH";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "LIDO_STETH";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "WETH";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "apy";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "authorizeProtocol";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "authorizedProtocols";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "timeInSeconds";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "calculateProjectedYield";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "positionIndex";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "closeYieldPosition";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      }
    ];
    readonly "name": "deauthorizeProtocol";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "emergencyWithdraw";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "positionIndex";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getPositionValue";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "getSimulatorInfo";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "isSimulator";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "string";
        readonly "name": "description";
        readonly "type": "string";
      },
      {
        readonly "internalType": "string";
        readonly "name": "warning";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "pure";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getTotalYieldEarned";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getUserYieldPositions";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "address";
            readonly "name": "protocol";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "timestamp";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "apy";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "address";
            readonly "name": "asset";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "amount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "shares";
            readonly "type": "uint256";
          }
        ];
        readonly "internalType": "struct DeFiIntegration.YieldPosition[]";
        readonly "name": "";
        readonly "type": "tuple[]";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "governor";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "hasGovernanceRights";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "protocolAPYs";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newGovernor";
        readonly "type": "address";
      }
    ];
    readonly "name": "setGovernor";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "apy";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setProtocolAuthorized";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "stakeWithLido";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "supplyToAave";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "supplyToCompound";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "totalYieldEarned";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "newAPY";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "updateProtocolAPY";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "userYieldPositions";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "protocol";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "timestamp";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "apy";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "address";
        readonly "name": "asset";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "shares";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "stateMutability": "payable";
    readonly "type": "receive";
  }
];

export declare const relicPayGovernanceAbi: readonly [
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "_governanceToken";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ActionNotAllowed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ExecutionFailed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientVotingPower";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidParameterData";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidTarget";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidTimelockParameters";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalAlreadyCanceled";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalAlreadyExecuted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalAlreadyQueued";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalNotActive";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalNotFound";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalNotQueued";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ProposalStale";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "QuorumNotMet";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ReentrancyGuardReentrantCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "TimelockNotExpired";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedExecutor";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnsupportedParameterType";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ValueTooLarge";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "target";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "bytes4";
        readonly "name": "selector";
        readonly "type": "bytes4";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "allowed";
        readonly "type": "bool";
      }
    ];
    readonly "name": "ActionAllowanceUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "enum RelicPayGovernance.ParameterType";
        readonly "name": "paramType";
        readonly "type": "uint8";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "target";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bytes";
        readonly "name": "data";
        readonly "type": "bytes";
      }
    ];
    readonly "name": "ParameterUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ProposalCanceled";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "proposer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "string";
        readonly "name": "title";
        readonly "type": "string";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "startTime";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "endTime";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ProposalCreated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ProposalExecuted";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "eta";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "expiresAt";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "ProposalQueued";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "executionDelay";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "executionGracePeriod";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "TimelockParametersUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "voter";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "support";
        readonly "type": "bool";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "votes";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "VoteCast";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MAX_EXECUTION_DELAY";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MAX_EXECUTION_GRACE_PERIOD";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MIN_EXECUTION_GRACE_PERIOD";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes4";
        readonly "name": "";
        readonly "type": "bytes4";
      }
    ];
    readonly "name": "allowedActions";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "authorizedExecutors";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "cancel";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "enum RelicPayGovernance.ParameterType";
            readonly "name": "paramType";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "address";
            readonly "name": "target";
            readonly "type": "address";
          },
          {
            readonly "internalType": "bytes";
            readonly "name": "data";
            readonly "type": "bytes";
          }
        ];
        readonly "internalType": "struct RelicPayGovernance.ParameterUpdate";
        readonly "name": "update";
        readonly "type": "tuple";
      }
    ];
    readonly "name": "checkParameterUpdate";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "ok";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "bytes4";
        readonly "name": "selector";
        readonly "type": "bytes4";
      },
      {
        readonly "internalType": "string";
        readonly "name": "reason";
        readonly "type": "string";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "components": readonly [
          {
            readonly "internalType": "enum RelicPayGovernance.ParameterType";
            readonly "name": "paramType";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "address";
            readonly "name": "target";
            readonly "type": "address";
          },
          {
            readonly "internalType": "bytes";
            readonly "name": "data";
            readonly "type": "bytes";
          }
        ];
        readonly "internalType": "struct RelicPayGovernance.ParameterUpdate[]";
        readonly "name": "updates";
        readonly "type": "tuple[]";
      }
    ];
    readonly "name": "execute";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "executionDelay";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "executionGracePeriod";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getExecutionWindow";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "eta";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "expiresAt";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "queued";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "ready";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "expired";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getProposal";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "id";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "proposer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "string";
        readonly "name": "title";
        readonly "type": "string";
      },
      {
        readonly "internalType": "string";
        readonly "name": "description";
        readonly "type": "string";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "startTime";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "endTime";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "forVotes";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "againstVotes";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "executed";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "canceled";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "getProposalCount";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "count";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "voter";
        readonly "type": "address";
      }
    ];
    readonly "name": "getVote";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "hasVoted";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "forVoteAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "againstVoteAmount";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "blockNumber";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "getVotingPower";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "votingPower";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "governanceToken";
    readonly "outputs": readonly [
      {
        readonly "internalType": "contract IGovernanceToken";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "isProposalActive";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "active";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "enum RelicPayGovernance.ParameterType";
        readonly "name": "paramType";
        readonly "type": "uint8";
      }
    ];
    readonly "name": "paramSelector";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes4";
        readonly "name": "selector";
        readonly "type": "bytes4";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "argBytes";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "pure";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "proposalActionsHash";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "proposalCount";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "proposalEta";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "proposalSnapshotBlock";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "proposalThreshold";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "proposals";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "id";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "proposer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "string";
        readonly "name": "title";
        readonly "type": "string";
      },
      {
        readonly "internalType": "string";
        readonly "name": "description";
        readonly "type": "string";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "startTime";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "endTime";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalForVotes";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalAgainstVotes";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "executed";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "canceled";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "string";
        readonly "name": "title";
        readonly "type": "string";
      },
      {
        readonly "internalType": "string";
        readonly "name": "description";
        readonly "type": "string";
      },
      {
        readonly "components": readonly [
          {
            readonly "internalType": "enum RelicPayGovernance.ParameterType";
            readonly "name": "paramType";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "address";
            readonly "name": "target";
            readonly "type": "address";
          },
          {
            readonly "internalType": "bytes";
            readonly "name": "data";
            readonly "type": "bytes";
          }
        ];
        readonly "internalType": "struct RelicPayGovernance.ParameterUpdate[]";
        readonly "name": "updates";
        readonly "type": "tuple[]";
      }
    ];
    readonly "name": "propose";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "components": readonly [
          {
            readonly "internalType": "enum RelicPayGovernance.ParameterType";
            readonly "name": "paramType";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "address";
            readonly "name": "target";
            readonly "type": "address";
          },
          {
            readonly "internalType": "bytes";
            readonly "name": "data";
            readonly "type": "bytes";
          }
        ];
        readonly "internalType": "struct RelicPayGovernance.ParameterUpdate[]";
        readonly "name": "updates";
        readonly "type": "tuple[]";
      }
    ];
    readonly "name": "queue";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "quorumVotes";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "target";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes4";
        readonly "name": "selector";
        readonly "type": "bytes4";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "allowed";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setActionAllowed";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "executor";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "authorized";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setExecutor";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "target";
        readonly "type": "address";
      },
      {
        readonly "internalType": "enum RelicPayGovernance.ParameterType";
        readonly "name": "paramType";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "allowed";
        readonly "type": "bool";
      }
    ];
    readonly "name": "setParameterAllowed";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_votingDelay";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "_votingPeriod";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "_proposalThreshold";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "_quorumVotes";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "updateGovernanceParameters";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "_executionDelay";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "_executionGracePeriod";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "updateTimelockParameters";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "userAgainstVotes";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "userForVotes";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "proposalId";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "support";
        readonly "type": "bool";
      }
    ];
    readonly "name": "vote";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "votingDelay";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "votingPeriod";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  }
];

export declare const bnplAbi: readonly [
  {
    readonly "inputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementAlreadyCompleted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementAlreadyDefaulted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementNotActive";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementNotFound";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "DiscountNotApproved";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "GracePeriodNotExpired";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientCollateral";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientPayment";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidAgreement";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "PaymentNotDue";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ReentrancyGuardReentrantCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "TransferFailed";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedCaller";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ValueTooLarge";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ZeroAddress";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ZeroAmount";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentCount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentAmount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "collateralAmount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "startTime";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AgreementCreated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "collateralClaimed";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentsClaimed";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AgreementDefaulted";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CollateralDeposited";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "DiscountApproved";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPaid";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "discount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "EarlyPayoff";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "InstallmentPaid";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPaid";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "agreements";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "collateralAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "installmentCount";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "startTime";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "paidInstallments";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "gracePeriodSeconds";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "enum Bnpl.BnplState";
        readonly "name": "state";
        readonly "type": "uint8";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "approveDiscount";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "collateralDeposited";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentCount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "collateralAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "gracePeriodSeconds";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "createAgreement";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "depositCollateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "discountAmount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "earlyPayoff";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getAgreement";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "address";
            readonly "name": "seller";
            readonly "type": "address";
          },
          {
            readonly "internalType": "address";
            readonly "name": "buyer";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "totalPrice";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "installmentAmount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "collateralAmount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "installmentCount";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "dueIntervalSeconds";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "startTime";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "paidInstallments";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "gracePeriodSeconds";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "enum Bnpl.BnplState";
            readonly "name": "state";
            readonly "type": "uint8";
          }
        ];
        readonly "internalType": "struct Bnpl.BnplAgreement";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "isGracePeriodExpired";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "isInstallmentDue";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bool";
        readonly "name": "";
        readonly "type": "bool";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "payInstallment";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "sellerApprovedDiscount";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "totalPaid";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "triggerDefault";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "withdrawCollateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "withdrawFunds";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  }
];

export declare const enhancedBnplAbi: readonly [
  {
    readonly "inputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "constructor";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "target";
        readonly "type": "address";
      }
    ];
    readonly "name": "AddressEmptyCode";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "AddressInsufficientBalance";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementAlreadyCompleted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementAlreadyDefaulted";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementNotActive";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "AgreementNotFound";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "FailedInnerCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "GracePeriodNotExpired";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientCollateral";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientCredit";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InsufficientPayment";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidAgreement";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidCollateralType";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "InvalidPaymentMethod";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "owner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableInvalidOwner";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "account";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnableUnauthorizedAccount";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "PaymentNotDue";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ReentrancyGuardReentrantCall";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "token";
        readonly "type": "address";
      }
    ];
    readonly "name": "SafeERC20FailedOperation";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "UnauthorizedCaller";
    readonly "type": "error";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "ValueTooLarge";
    readonly "type": "error";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentCount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentAmount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "enum EnhancedBnpl.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "startTime";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AgreementCreated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "collateralClaimed";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentsClaimed";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "AgreementDefaulted";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "enum EnhancedBnpl.CollateralType";
        readonly "name": "collateralType";
        readonly "type": "uint8";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CollateralDeposited";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "availableCredit";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "usedCredit";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "CreditLineUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPaid";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "discount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "EarlyPayoff";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "enum EnhancedBnpl.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      }
    ];
    readonly "name": "InstallmentPaid";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalPaid";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "previousOwner";
        readonly "type": "address";
      },
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "OwnershipTransferred";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "ethBalance";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalBalance";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "SellerBalanceUpdated";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "bool";
        readonly "name": "isETH";
        readonly "type": "bool";
      }
    ];
    readonly "name": "SellerWithdrawal";
    readonly "type": "event";
  },
  {
    readonly "anonymous": false;
    readonly "inputs": readonly [
      {
        readonly "indexed": true;
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "yieldAmount";
        readonly "type": "uint256";
      },
      {
        readonly "indexed": false;
        readonly "internalType": "uint256";
        readonly "name": "totalYield";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "YieldAccrued";
    readonly "type": "event";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "CREDIT_LIMIT_RATIO";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "MAX_CREDIT_UTILIZATION";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "YIELD_UPDATE_INTERVAL";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "agreements";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentAmount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "installmentCount";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "startTime";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "paidInstallments";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "uint32";
        readonly "name": "gracePeriodSeconds";
        readonly "type": "uint32";
      },
      {
        readonly "internalType": "enum EnhancedBnpl.BnplState";
        readonly "name": "state";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "enum EnhancedBnpl.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "collateralPositionId";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "collateralPositions";
    readonly "outputs": readonly [
      {
        readonly "internalType": "enum EnhancedBnpl.CollateralType";
        readonly "name": "collateralType";
        readonly "type": "uint8";
      },
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bool";
        readonly "name": "autoReinvest";
        readonly "type": "bool";
      },
      {
        readonly "internalType": "uint40";
        readonly "name": "lastUpdateTime";
        readonly "type": "uint40";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "yieldAccrued";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "buyer";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "totalPrice";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentCount";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "dueIntervalSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "gracePeriodSeconds";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "enum EnhancedBnpl.PaymentMethod";
        readonly "name": "paymentMethod";
        readonly "type": "uint8";
      }
    ];
    readonly "name": "createAgreementWithCredit";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "creditLines";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "collateralValue";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "creditLimit";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "availableCredit";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "usedCredit";
        readonly "type": "uint256";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "creditUtilization";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "depositERC20Collateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "depositETHCollateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getAgreement";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "address";
            readonly "name": "seller";
            readonly "type": "address";
          },
          {
            readonly "internalType": "address";
            readonly "name": "buyer";
            readonly "type": "address";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "totalPrice";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "installmentAmount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "installmentCount";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "dueIntervalSeconds";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "startTime";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "paidInstallments";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "uint32";
            readonly "name": "gracePeriodSeconds";
            readonly "type": "uint32";
          },
          {
            readonly "internalType": "enum EnhancedBnpl.BnplState";
            readonly "name": "state";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "enum EnhancedBnpl.PaymentMethod";
            readonly "name": "paymentMethod";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "bytes32";
            readonly "name": "collateralPositionId";
            readonly "type": "bytes32";
          }
        ];
        readonly "internalType": "struct EnhancedBnpl.BnplAgreement";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      },
      {
        readonly "internalType": "bytes32";
        readonly "name": "positionId";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "getCollateralPosition";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "enum EnhancedBnpl.CollateralType";
            readonly "name": "collateralType";
            readonly "type": "uint8";
          },
          {
            readonly "internalType": "address";
            readonly "name": "tokenAddress";
            readonly "type": "address";
          },
          {
            readonly "internalType": "bool";
            readonly "name": "autoReinvest";
            readonly "type": "bool";
          },
          {
            readonly "internalType": "uint40";
            readonly "name": "lastUpdateTime";
            readonly "type": "uint40";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "amount";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "yieldAccrued";
            readonly "type": "uint256";
          }
        ];
        readonly "internalType": "struct EnhancedBnpl.CollateralPosition";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getCreditLine";
    readonly "outputs": readonly [
      {
        readonly "components": readonly [
          {
            readonly "internalType": "uint256";
            readonly "name": "collateralValue";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "creditLimit";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "availableCredit";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "usedCredit";
            readonly "type": "uint256";
          },
          {
            readonly "internalType": "uint256";
            readonly "name": "creditUtilization";
            readonly "type": "uint256";
          }
        ];
        readonly "internalType": "struct EnhancedBnpl.CreditLine";
        readonly "name": "";
        readonly "type": "tuple";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      }
    ];
    readonly "name": "getSellerBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "seller";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "getSellerTokenBalance";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getTotalCollateralValue";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "user";
        readonly "type": "address";
      }
    ];
    readonly "name": "getUserCollateralPositionIds";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32[]";
        readonly "name": "";
        readonly "type": "bytes32[]";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "owner";
    readonly "outputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "agreementId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "installmentNumber";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "payInstallment";
    readonly "outputs": readonly [];
    readonly "stateMutability": "payable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "renounceOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "sellerBalances";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "sellerTokenBalances";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "rateBasisPoints";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "setYieldRate";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "name": "totalPaid";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "newOwner";
        readonly "type": "address";
      }
    ];
    readonly "name": "transferOwnership";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "userCollateralPositionIds";
    readonly "outputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "";
        readonly "type": "bytes32";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "bytes32";
        readonly "name": "positionId";
        readonly "type": "bytes32";
      },
      {
        readonly "internalType": "uint256";
        readonly "name": "amount";
        readonly "type": "uint256";
      }
    ];
    readonly "name": "withdrawCollateral";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [];
    readonly "name": "withdrawSellerBalance";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "tokenAddress";
        readonly "type": "address";
      }
    ];
    readonly "name": "withdrawSellerTokenBalance";
    readonly "outputs": readonly [];
    readonly "stateMutability": "nonpayable";
    readonly "type": "function";
  },
  {
    readonly "inputs": readonly [
      {
        readonly "internalType": "address";
        readonly "name": "";
        readonly "type": "address";
      }
    ];
    readonly "name": "yieldRates";
    readonly "outputs": readonly [
      {
        readonly "internalType": "uint256";
        readonly "name": "";
        readonly "type": "uint256";
      }
    ];
    readonly "stateMutability": "view";
    readonly "type": "function";
  }
];
