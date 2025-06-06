# PipeCat Client JS SDK

A TypeScript SDK for PipeCat with transport layer implementations.

## Installation

1. First, create a personal access token (classic) with the `read:packages` scope from GitHub:
   - Go to GitHub → Settings → Developer settings → Personal access tokens → Generate new token
   - Select `read:packages` scope
   - Copy the generated token

2. Create or update your `~/.npmrc` file with the following content:
   ```
   @think41:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
   ```
   Replace `YOUR_GITHUB_USERNAME` with your GitHub username and `YOUR_GITHUB_TOKEN` with the token you generated.

3. Install the package:
   ```bash
   npm install @think41/client-js-standalone
   ```

## Usage

```typescript
import { PipeCatClient } from '@think41/client-js-standalone';

// Your code here
```

## Development

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Build the project:
   ```bash
   npm run build
   ```

## Publishing New Versions

1. Update the version in `package.json`
2. Create a new GitHub release with a tag matching the version (e.g., `v1.0.0`)
3. The GitHub Action will automatically publish the package to GitHub Packages

## License

MIT