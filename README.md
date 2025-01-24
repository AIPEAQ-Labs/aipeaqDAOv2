```
pnpm run compile
pnpm run test

npx hardhat deploy --tags "GrantMinterRole" --network peaqTestnet;
npx hardhat deploy --tags "GrantDefaultAdminRole" --network peaqTestnet;
npx hardhat deploy --tags "GrantModeratorRole" --network peaqTestnet;
```