# ADR-004: the request channel

Status: accepted, 2026-09-28
Context: roadmap "Browser extension revival against v2 ABI, part b: the request channel." ADR-003
decided that the extension quotes and never creates, because `createAgreementWithRWA` is
`onlyOwner` and the only sound terminal action on the buyer's side is a signed request that
whoever holds owner can act on later. This ADR is that request: its exact shape, how it moves from
content script to service worker to popup and out to an operator, and how the operator checks a
created agreement against it before treating the two as the same deal.

## What a quote cannot survive being handed around as

A quote from `extension/lib/offer.js` is unsigned, unscoped in time, and says nothing about which
deployment it was computed against. Handed to an operator as-is it invites three separate failures.

Unsigned, anyone who saw a quote, or fabricated one that merely looks like the schema, could submit
it claiming a buyer agreed to it. There is nothing in a quote object that ties it to a wallet.

Unscoped in time, a quote computed against today's credit line does not expire. Replayed weeks
later against a buyer who has since spent that credit elsewhere, or against a line an operator now
reads differently, it is stale data asked to stand in for present consent.

Unscoped to a deployment, the same buyer terms could in principle be replayed against a different
RelicPay instance, a different chain, or a redeployed instance of this one at a new address, since
nothing in the quote says which contract it was quoted against.

The request format has to close all three, and it has to do it without asking the buyer to trust
anything the extension merely tells them, per ADR-003's rule that the page (and, by extension, the
content script) is not where the buyer agrees.

## Decision

**EIP-712 typed data over the quoted terms, nothing more.** The buyer's wallet signs a struct
called `AgreementRequest`, domain-separated by `RelicPay`, a version string, the chain id, and the
specific RelicPay contract address the request targets:

```
AgreementRequest {
  address buyer;
  address seller;
  address nftContract;
  uint256 tokenId;
  uint256 totalPrice;
  uint32  installmentCount;
  uint32  dueIntervalSeconds;
  uint32  gracePeriodSeconds;
  uint8   paymentMethod;
  bytes32 requestId;
  uint256 expiry;
}
```

Every field here is one `createAgreementWithRWA` reads or one the buyer needs to recognize the
deal: the asset (`nftContract`, `tokenId`), the money (`totalPrice`, the schedule shape), and the
counterparties. `physicalId` and `metadataURI` are deliberately left out of the signed struct: they
are not checked by `createAgreementWithRWA` (only `authorizedNFTs[nftContract]` is), and a struct
field the contract cannot enforce is a field whose mismatch the buyer would discover only after the
fact. The operator-side match in this ADR still compares them when present, as a courtesy check
against clerical error, but a mismatch there is not what protects the buyer; the domain separator
and the asset/price/schedule fields are.

`requestId` is a 32-byte value the buyer's client generates (a fresh random value per request, not
derived from anything guessable), and it exists only to give the operator something to deduplicate
on. It carries no meaning about the agreement itself. `expiry` is a Unix timestamp the client sets;
an operator refuses a request whose expiry has passed before it ever reads chain state.

**The domain's `verifyingContract` is the RelicPay address the buyer intends to use, and `chainId`
is the chain they intend to use it on.** This is what makes a request over Sepolia RelicPay
unusable against a mainnet deployment, or against a redeployed instance at a new address, even if
every other field were identical: the EIP-712 hash the buyer actually signed does not exist for any
other domain, so a recovered signer computed under a different domain is simply a different
(wrong) address, not the buyer.

**Signature verification is signer-equals-buyer, not signer-is-anyone-authorized.** The request
names its own buyer in the `buyer` field, and the one check that matters is that the recovered
signer for the exact typed-data hash equals that address. There is no separate authorization list;
the buyer authorizing their own request is the only authorization this layer performs. Whether that
buyer's credit line then covers the request is what `offer.js`'s quoter already answered once, and
the operator is expected to answer it again at submission time (see below), not to trust the
quote's old answer.

**Expiry and a replay store are checked before anything else, including the signature.** Checking
order matters for a service that will eventually sit behind a network endpoint: a request that
fails a `Map.has()` lookup or a timestamp comparison costs nothing, while recovering a signature is
comparatively expensive and reading `authorizedNFTs` from a node costs a network round trip. So
`checkRequest` in `extension/lib/request.js` orders its checks cheapest-and-most-likely-to-reject
first: freshness, then replay, then signature. This is a performance ordering, not a security one;
none of the three may be skipped, and a request that passes all three is not yet authorized to
create anything, only authorized to be looked at.

**The operator re-quotes; the signed request is intent, not a bypass.** Nothing in this ADR lets an
operator skip calling `createOfferQuoter().quote(...)` again with the request's own terms before
acting on it. A request signed an hour ago is exactly the kind of stale data ADR-003's `at` pinning
exists to catch: the buyer's credit line may have moved, the NFT may no longer be authorized, the
relic may have been sold to someone else in the interim. The signature proves who asked; it does
not prove the ask is still good. This is also why `paymentMethod` is a request field: the operator
does not get to choose it after the fact.

**How it reaches the operator: a signed HTTP POST body, transport-agnostic beyond that.**
`extension/lib/request.js` exports `serializeRequest` / `deserializeRequest` (BigInt-safe JSON
round trip, since `JSON.stringify` cannot carry a `bigint`) and a thin `submitRequest({ endpoint,
domain, message, signature, fetchImpl })` that POSTs the serialized envelope to a configured
endpoint and surfaces a non-2xx response as a `RequestError`. The module does not pick the
endpoint, does not authenticate the operator, and does not run a server: those are deployment
concerns for whoever operates a given RelicPay instance, and different operators may prefer a
webhook, a relay queue, or a self-hosted endpoint listening for the same envelope. What this ADR
fixes is the envelope's shape and the fact that it is exactly the signed typed data plus the
signature, so any transport an operator chooses is carrying the same tamper-evident payload.

**Matching a created agreement back to the request is a field-by-field comparison, not a
recomputed id.** `createAgreementWithRWA`'s `agreementId` is
`keccak256(seller, buyer, totalPrice, installmentCount, dueIntervalSeconds, block.timestamp,
userNonces[buyer]++)`, which depends on the block timestamp and a contract-side nonce neither party
can know in advance. So a request cannot predict the id it will produce, and matching has to read
the agreement the operator says it created and compare its `seller`, `buyer`, `totalPrice`,
`installmentCount`, `dueIntervalSeconds`, `gracePeriodSeconds`, `paymentMethod`, and
`relic.nftContract` / `relic.tokenId` against the signed message. `matchAgreementToRequest` in
`extension/lib/request.js` does exactly this and returns every mismatch found, not just the first,
since a buyer disputing a created agreement needs to see the whole diff.

**The MV3 message boundary carries the same objects, and validates them at every edge.**
`extension/lib/messages.js` names four crossings and, per ADR-003, keeps quoting and chain reads
entirely on the service-worker side of them:

1. `LISTING_SCRAPED`, content script to service worker: the claim from the page, unchanged from
   what `offer.js` already treats as untrusted.
2. `QUOTE_READY`, service worker to content script and popup: the result of `quote()`, computed
   only in the service worker.
3. `REQUEST_SIGNED`, popup to service worker: the domain, message and signature once the buyer's
   wallet has signed, so the service worker can run `checkRequest` and then `submitRequest`.
4. `SUBMIT_RESULT`, service worker to popup: whether the operator accepted the submission.

Each builder validates its own payload shape before returning a message object, and a
`validateMessage` dispatcher on the receiving side refuses anything that does not match one of the
four known shapes. None of `messages.js` touches `chrome.*`; wiring these into
`chrome.runtime.sendMessage` / `onMessage` is part c's job, once the extension shell exists to wire
it into. Message contexts in MV3 already isolate a content script's JavaScript from the page's, so
this validation is not a defense against a hostile page reaching into the service worker directly;
it is the same discipline `offer.js` already applies to a listing, applied at every hop a value
takes on its way to a signature.

## Why not simpler

**Why not let the extension hold a session key and sign on the buyer's behalf?** Then the
extension, not the buyer, is the thing being trusted, and ADR-003's whole argument for stopping at
a request rather than a transaction collapses: a session key that can sign requests looking exactly
like the buyer's own is functionally the hot owner key ADR-003 rejected, just moved one hop
earlier.

**Why not a raw signed message instead of EIP-712?** A raw `personal_sign` over a JSON blob gives
the buyer's wallet nothing to show them beyond an opaque hash; most wallets render EIP-712 structs
field by field, so a buyer signing an `AgreementRequest` actually sees the seller, the price and the
schedule they are agreeing to, which is the same "the buyer must see what they are agreeing to"
principle ADR-003 applies to the confirmed amount.

**Why not have the operator trust the quote instead of re-quoting?** The quote is a snapshot at a
pinned block; treating it as durable authorization is the same mistake ADR-002 already named for a
stale collateral value on the dashboard's write side, moved to a new layer.

## Consequences

`extension/lib/request.js` and `extension/lib/messages.js` are both framework-free and `chrome.*`
free, provable against ganache exactly as `offer.js` is: build a quote, sign a request over it with
a real private key, submit it to a stub transport, create the matching agreement on a live chain,
and assert `matchAgreementToRequest` reports no mismatches. The suite for this ADR proves the
inverse cases too: an expired request, a replayed `requestId`, a request signed by the wrong
account, a request whose message was altered after signing, and a created agreement whose terms
diverge from what was signed.

What is still owed to part c: the actual `chrome.runtime` wiring, the popup UI that renders an
`AgreementRequest` for the buyer and drives their wallet's `eth_signTypedData_v4`, and the
manifest's seller-scoped `host_permissions`. What is still owed to the operator side of a real
deployment: an actual endpoint implementing the POST target `submitRequest` calls, which is
deployment-specific and out of scope for a framework-free library.
