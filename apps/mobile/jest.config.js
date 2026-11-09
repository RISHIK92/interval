// P4-W19-S01 (Q-P4-01): jest-expo runs the app's tests in Node with React Native's mocks.
// A file's first router render transforms the whole app tree, past jest's 5 s default
// while `pnpm check` runs everything at once.
export default {
  preset: "jest-expo",
  setupFilesAfterEnv: ["./test/setup.ts"],
  testTimeout: 30_000,
};
