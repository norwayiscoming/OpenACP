// Testing utilities for OpenACP plugin and adapter authors.
//
// These helpers exist so plugin authors can validate their adapters against
// the IChannelAdapter contract without wiring up a real messaging platform.
// Import from `@openacp/cli/testing` in your plugin test files.

/**
 * Runs the standard IChannelAdapter conformance test suite against a given adapter factory.
 *
 * Verifies that the adapter correctly implements all required interface methods
 * (name, capabilities, sendMessage, etc.) and behaves within the expected contract.
 * Use this in your adapter's test file to catch regressions and ensure compatibility
 * with the OpenACP core routing layer.
 *
 * @param createAdapter - Factory function that returns a fresh adapter instance for each test.
 * @param cleanup - Optional teardown callback run after each test (e.g., stop the adapter).
 *
 * @example
 * ```ts
 * import { runAdapterConformanceTests } from '@openacp/cli/testing'
 * import { MyAdapter } from './my-adapter.js'
 *
 * runAdapterConformanceTests(() => new MyAdapter(mockConfig))
 * ```
 */
export { runAdapterConformanceTests } from './core/adapter-primitives/__tests__/adapter-conformance.js'
