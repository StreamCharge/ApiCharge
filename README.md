# ApiCharge
Digital Service Monetization and Democratization

**Important note for SCF reviewers**: Code is private and proprietary. During phase 3 (see issue labels) the Soroban smart contract will be finalized and made public. The ApiCharge server platform binaries will be kept private permanently. Docker Images for the ApiCharge templates will not have their Dockerfiles made public. The Mac, Windows and Linux native wallet desktop manager apps will be closed source, and the future iOS, Android and Smart TV consumer apps will be closed source BUT with the support of the community, whitelabel/skeleton apps can be derived from these with ApiCharge and StreamCharge proprietary features removed, so that anyone may build native Stellar-integrated apps from a stable starting point, with secure key management, account management, and on/off ramping integrated.

## Overview

Please use this repo to log issues and request features.

Information, guidance, documentation, and code will be transferred to this site for the ApiCharge desktop B2B apps, mobile consumer apps, and server stablecoin/digital currency pricing and payment gateway. 

Public beta progress planned for the week of 27/Oct/2025

More to come...

Your input, feedback and help is warmly appreciated.

Welcome to ApiCharge!

## Technical Architecture for ML/AI improvements

For the full architecture and detailed technical documents of the project, please refer to the [official documentation](https://apicharge.com/Documentation/index.html) 
<img width="1295" height="613" alt="image" src="https://github.com/user-attachments/assets/2bdd0a1b-2d44-4457-bc1e-e25ba0dc0c19" />


This section is for the benefit of SCF reviewers who need a distilled version of the platform, its changes, and direction for ML and AI use cases.

### Context

The ApiCharge project is a platform for monetization of digital services. It provides tools and technologies for providers to productionize and charge for digital services both new and existing, removing friction wherever possible, taking advantage of stablecoin and new stablecoin supportive legislation, such as MiCA and GENIUS, to allow creators and developers to own their services, without payment gateways, bureaucracy, or middlemen. This submission is about bringing the platform to market through a narrow focus on ML/AI developers. Right now the ML/AI creator or developer has only 2 options: do-it-yourself and learn IT infrastructure, scaling, pricing, payments and more, or use a middleman like Replicate.com or HuggingFace, or even RapidAPI, who take their cut. Consumers of those hosted services then have to consider platform lockin. ApiCharge will bring a third option to ML/AI developers: use ApiCharge to deploy models and workflows, manage infrastructure, collect revenue and modify pricing.

### ApiCharge Ecosystem Architecture

<img width="1200" height="675" alt="image" src="https://github.com/user-attachments/assets/52b09f2d-d6a7-4c3d-8c07-0045fd1106d4" />


The ApiCharge Desktop Apps are installed by users (in this submission, ML / AI devs ). They add their ML models to the local library or later configure access to other libraries, such as HuggingFace. Their aim is to productionize and monetize. They click their model, hit deploy, choose a compatible template from the ApiCharge.com template library (the apps recognise what models are compatible with which server templates) and request a machine. The app takes the template requirements, and through the existing Vast.ai integration (later other marketplaces), the machine is deployed, the server installed, and the app given a direct, secret connection to the server. From there the ApiCharge Desktop app allows pricing management, publication of the service on the Apicharge.com catalogue/marketplace (when implementation is completed for that feature) Furthermore, each ApiCharge server already offers its own automatically generated HTML page and OpenAPI technical pages.

The same app is used to discover and consume services, or when the service is browsed to on the web, users can be deeplinked into the native app to install it or to the payment page. The app also allows the user to import services they know of privately. Once the services are in the local service catalogue, their offerings can be asked for an actual quote, and the service access purchased in-app, as the app is a native wallet with fiat->stable on ramps.

There are various other architectures supported too - as the existing ApiCharge server binaries allow for clustered configuration behind load balancers, and other HA support.

### ApiCharge Network Component Architecture
<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/32477b80-cb97-4cf3-b1e2-54fe7b2209aa" />


### ApiCharge Protocol
The core of ApiCharge is the ApiCharge Subscription Protocol, a unique approach to API monetization that combines the flexibility of micropayments with the predictability of subscriptions, offering unprecedented pricing control over network guaranteed qualities of service.

An ApiCharge Subscription is a time-bound, quality-of-service guaranteed access grant to a specific API route. Unlike traditional micropayments that charge per API call, ApiCharge Subscriptions provide access for a specific duration (minutes to months) with defined usage parameters.

The protocol flow usually consists of the following steps:

- Client requests a signed Quote containing available services and their pricing
- Client selects a Route Quote and requests a Purchase Instruction
- Client authorizes payment via Stellar Soroban blockchain
- Server issues a GrantedAccessToken representing the purchased ApiCharge Subscription
- Client creates AccessTokens from the GrantedAccessToken to access services
- ApiCharge validates tokens and enforces purchased quality-of-service parameters

This approach solves the fundamental problems of API monetization by batching multiple service invocations into a single payment while maintaining the flexibility of pay-as-you-use models.

After the changes in the submission roadmap, protocol variants will be on offer:

- Client hits server service route
- Client receives 402 HTTP with payment guidance in multiple forms, AI guidance, x402 options, and even a directly signable payment auth message
- Client signs and posts to the ApiCharge endpoint of that server
- Client receives and generates client-signed access tokens with duration of their choice

Example:
<img width="1280" height="720" alt="image" src="https://github.com/user-attachments/assets/f0bc6af0-e4a9-4930-8811-5994328eb540" />

1. **Request Signed Quote**: Client requests a signed Quote containing price, duration, and quality-of-service parameters for various service routes (RouteQuotes). ApiCharge returns a cryptographically signed Quote with a time-limited validity window.
2. **Purchase Instruction Request**: Client requests a purchase instruction for a selected RouteQuote, usually a minutes or hours of a certain quality of service for a single route. ApiCharge prepares and returns a transaction for the payment 3platform's smart contract.
3. **Client Authorise Payment**: Client signs the transaction (which contains the RouteQuote) and returns it to ApiCharge. ApiCharge submits the signed transaction to the payment platform.
4.** Payment Execution**: The payment platform's smart contract verifies the quote authenticity, validates expiration, and transfers funds.
5. **ApiCharge Subscription Issuance**: ApiCharge issues a signed ApiCharge Subscription containing the original service parameters (the RouteQuote).
6. **Service Use**: Client creates AccessTokens from the ApiCharge Subscription (with client-controlled lifetimes) and requests service access by adding it to either a header or cookie. ApiCharge validates the AccessToken, enforces purchased quality-of-service parameters, and proxies the request to the service.



