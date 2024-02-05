"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestResultProvider = exports.TestSuiteRecord = void 0;
const TestReconciliationState_1 = require("./TestReconciliationState");
const TestResult_1 = require("./TestResult");
const match = require("./match-by-context");
const helpers_1 = require("../helpers");
const test_result_events_1 = require("./test-result-events");
const match_node_1 = require("./match-node");
const snapshot_provider_1 = require("./snapshot-provider");
const jest_editor_support_1 = require("jest-editor-support");
const sortByStatus = (a, b) => {
    if (a.status === b.status) {
        return 0;
    }
    return TestResult_1.TestResultStatusInfo[a.status].precedence - TestResult_1.TestResultStatusInfo[b.status].precedence;
};
class TestSuiteRecord {
    constructor(testFile, reconciler, parser) {
        this.testFile = testFile;
        this.reconciler = reconciler;
        this.parser = parser;
        this._status = TestReconciliationState_1.TestReconciliationState.Unknown;
        this._message = '';
    }
    get status() {
        return this._status;
    }
    get message() {
        return this._message;
    }
    get results() {
        return this._results;
    }
    get sorted() {
        return this._sorted;
    }
    get isTestFile() {
        return this._isTestFile;
    }
    /**
     * parse test file and create sourceContainer, if needed.
     * @returns TestBlocks | 'failed'
     */
    get testBlocks() {
        var _a, _b;
        if (!this._testBlocks) {
            try {
                const pResult = this.parser.parseTestFile(this.testFile);
                if (![pResult.describeBlocks, pResult.itBlocks].find((blocks) => blocks.length > 0)) {
                    // nothing in this file yet, skip. Otherwise we might accidentally publish a source file, for example
                    return 'failed';
                }
                const sourceContainer = match.buildSourceContainer(pResult.root);
                this._testBlocks = Object.assign(Object.assign({}, pResult), { sourceContainer });
                const snapshotBlocks = this.parser.parseSnapshot(this.testFile).blocks;
                if (snapshotBlocks.length > 0) {
                    this.updateSnapshotAttr(sourceContainer, snapshotBlocks);
                }
            }
            catch (e) {
                // normal to fail, for example when source file has syntax error
                if ((_a = this.parser.options) === null || _a === void 0 ? void 0 : _a.verbose) {
                    console.log(`parseTestBlocks failed for ${this.testFile}`, e);
                }
                this._testBlocks = 'failed';
            }
        }
        return (_b = this._testBlocks) !== null && _b !== void 0 ? _b : 'failed';
    }
    get assertionContainer() {
        if (!this._assertionContainer) {
            const assertions = this.reconciler.assertionsForTestFile(this.testFile);
            if (assertions && assertions.length > 0) {
                this._assertionContainer = match.buildAssertionContainer(assertions);
            }
        }
        return this._assertionContainer;
    }
    updateSnapshotAttr(container, snapshots) {
        const isWithin = (snapshot, range) => {
            const zeroBasedLine = snapshot.node.loc.start.line - 1;
            return !!range && range.start.line <= zeroBasedLine && range.end.line >= zeroBasedLine;
        };
        if (container.name !== match_node_1.ROOT_NODE_NAME &&
            container.attrs.range &&
            !snapshots.find((s) => isWithin(s, container.attrs.range))) {
            return;
        }
        container.childData.forEach((block) => {
            const snapshot = snapshots.find((s) => isWithin(s, block.attrs.range));
            if (snapshot) {
                block.attrs.snapshot = snapshot.isInline ? 'inline' : 'external';
            }
        });
        container.childContainers.forEach((childContainer) => this.updateSnapshotAttr(childContainer, snapshots));
    }
    update(change) {
        var _a, _b;
        this._status = (_a = change.status) !== null && _a !== void 0 ? _a : this.status;
        this._message = (_b = change.message) !== null && _b !== void 0 ? _b : this.message;
        this._isTestFile = 'isTestFile' in change ? change.isTestFile : this._isTestFile;
        this._results = 'results' in change ? change.results : this._results;
        this._sorted = 'sorted' in change ? change.sorted : this._sorted;
        this._assertionContainer =
            'assertionContainer' in change ? change.assertionContainer : this._assertionContainer;
    }
}
exports.TestSuiteRecord = TestSuiteRecord;
class Parser {
    constructor(snapshotProvider, options) {
        this.snapshotProvider = snapshotProvider;
        this.options = options;
    }
    parseSnapshot(testPath) {
        const res = this.snapshotProvider.parse(testPath, this.options);
        return res;
    }
    parseTestFile(testPath) {
        var _a;
        const res = (0, jest_editor_support_1.parse)(testPath, undefined, (_a = this.options) === null || _a === void 0 ? void 0 : _a.parserOptions);
        return res;
    }
}
class TestResultProvider {
    constructor(extEvents, options = { verbose: false }) {
        this.reconciler = new jest_editor_support_1.TestReconciler();
        this._options = options;
        this.events = (0, test_result_events_1.createTestResultEvents)();
        this.testSuites = new Map();
        this.snapshotProvider = new snapshot_provider_1.SnapshotProvider();
        this.parser = new Parser(this.snapshotProvider, this._options);
        extEvents.onTestSessionStarted.event(this.onSessionStart.bind(this));
    }
    dispose() {
        this.events.testListUpdated.dispose();
        this.events.testSuiteChanged.dispose();
    }
    set options(options) {
        this._options = options;
        this.parser.options = this._options;
        this.testSuites.clear();
    }
    addTestSuiteRecord(testFile) {
        const record = new TestSuiteRecord(testFile, this.reconciler, this.parser);
        this.testSuites.set(testFile, record);
        return record;
    }
    onSessionStart() {
        this.testSuites.clear();
        this.reconciler = new jest_editor_support_1.TestReconciler();
    }
    groupByRange(results) {
        if (!results.length) {
            return results;
        }
        // build a range based map
        const byRange = new Map();
        results.forEach((r) => {
            // Q: is there a better/efficient way to index the range?
            const key = `${r.start.line}-${r.start.column}-${r.end.line}-${r.end.column}`;
            const list = byRange.get(key);
            if (!list) {
                byRange.set(key, [r]);
            }
            else {
                list.push(r);
            }
        });
        // sort the test by status precedence
        byRange.forEach((list) => list.sort(sortByStatus));
        //merge multiResults under the primary (highest precedence)
        const consolidated = [];
        byRange.forEach((list) => {
            if (list.length > 1) {
                list[0].multiResults = list.slice(1);
            }
            consolidated.push(list[0]);
        });
        return consolidated;
    }
    updateTestFileList(testFiles) {
        this.testFiles = testFiles;
        // clear the cache in case we have cached some non-test files prior
        this.testSuites.clear();
        this.events.testListUpdated.fire(testFiles);
    }
    getTestList() {
        if (this.testFiles && this.testFiles.length > 0) {
            return this.testFiles;
        }
        return Array.from(this.testSuites.keys()).filter((f) => this.isTestFile(f));
    }
    isTestFile(fileName) {
        var _a, _b, _c;
        console.error('1');
        if (((_a = this.testFiles) === null || _a === void 0 ? void 0 : _a.includes(fileName)) || ((_b = this.testSuites.get(fileName)) === null || _b === void 0 ? void 0 : _b.isTestFile)) {
            return true;
        }
        console.error('2');
        //if we already have testFiles, then we can be certain that the file is not a test file
        if (this.testFiles) {
            return false;
        }
        console.error('3');
        const _record = (_c = this.testSuites.get(fileName)) !== null && _c !== void 0 ? _c : this.addTestSuiteRecord(fileName);
        if (_record.isTestFile === false) {
            return false;
        }
        console.error('4');
        // check if the file is a test file by parsing the content
        const isTestFile = _record.testBlocks !== 'failed';
        _record.update({ isTestFile });
        console.error('5');
        return isTestFile;
    }
    getTestSuiteResult(filePath) {
        return this.testSuites.get(filePath);
    }
    /**
     * match assertions with source file, if successful, update cache, results and related.
     * Will also fire testSuiteChanged event
     *
     * if the file is not a test or can not be parsed, the results will be undefined.
     * any other errors will result the source blocks to be returned as unmatched block.
     **/
    updateMatchedResults(filePath, record) {
        let error;
        let status = record.status;
        // make sure we do not fire changeEvent since that will be proceeded with match or unmatched event anyway
        const testBlocks = record.testBlocks;
        if (testBlocks === 'failed') {
            record.update({ status: 'KnownFail', message: 'test file parse error', results: [] });
            return;
        }
        const { itBlocks } = testBlocks;
        if (record.assertionContainer) {
            try {
                const results = this.groupByRange(match.matchTestAssertions(filePath, testBlocks.sourceContainer, record.assertionContainer, this._options.verbose));
                record.update({ results });
                this.events.testSuiteChanged.fire({
                    type: 'result-matched',
                    file: filePath,
                });
                return;
            }
            catch (e) {
                console.warn(`failed to match test results for ${filePath}:`, e);
                error = `encountered internal match error: ${e}`;
                status = 'KnownFail';
            }
        }
        else {
            // there might be many reasons for this, for example the test is not yet run, so leave it as unknown
            error = 'no assertion generated for file';
        }
        // no need to do groupByRange as the source block will not have blocks under the same location
        record.update({
            status,
            message: error,
            results: itBlocks.map((t) => match.toMatchResult(t, 'no assertion found', 'match-failed')),
        });
        // file match failed event so the listeners can display the source blocks instead
        this.events.testSuiteChanged.fire({
            type: 'result-match-failed',
            file: filePath,
            sourceContainer: testBlocks.sourceContainer,
        });
    }
    /**
     * returns matched test results for the given file
     * @param filePath
     * @returns valid test result list or an empty array if the source file is not a test or can not be parsed.
     */
    getResults(filePath, record) {
        var _a;
        if (!this.isTestFile(filePath)) {
            return;
        }
        const _record = (_a = record !== null && record !== void 0 ? record : this.testSuites.get(filePath)) !== null && _a !== void 0 ? _a : this.addTestSuiteRecord(filePath);
        if (_record.results) {
            return _record.results;
        }
        this.updateMatchedResults(filePath, _record);
        return _record.results;
    }
    /**
     * returns sorted test results for the given file
     * @param filePath
     * @returns valid sorted test result or undefined if the file is not a test.
     */
    getSortedResults(filePath) {
        var _a;
        if (!this.isTestFile(filePath)) {
            return;
        }
        const record = (_a = this.testSuites.get(filePath)) !== null && _a !== void 0 ? _a : this.addTestSuiteRecord(filePath);
        if (record.sorted) {
            return record.sorted;
        }
        const sorted = {
            fail: [],
            skip: [],
            success: [],
            unknown: [],
        };
        const testResults = this.getResults(filePath, record);
        if (!testResults) {
            return;
        }
        for (const test of testResults) {
            if (test.status === TestReconciliationState_1.TestReconciliationState.KnownFail) {
                sorted.fail.push(test);
            }
            else if (test.status === TestReconciliationState_1.TestReconciliationState.KnownSkip) {
                sorted.skip.push(test);
            }
            else if (test.status === TestReconciliationState_1.TestReconciliationState.KnownSuccess) {
                sorted.success.push(test);
            }
            else {
                sorted.unknown.push(test);
            }
        }
        record.update({ sorted });
        return sorted;
    }
    updateTestResults(data, process) {
        const results = this.reconciler.updateFileWithJestStatus(data);
        results === null || results === void 0 ? void 0 : results.forEach((r) => {
            var _a;
            const record = (_a = this.testSuites.get(r.file)) !== null && _a !== void 0 ? _a : this.addTestSuiteRecord(r.file);
            record.update({
                status: r.status,
                message: r.message,
                isTestFile: true,
                assertionContainer: undefined,
                results: undefined,
                sorted: undefined,
            });
        });
        this.events.testSuiteChanged.fire({
            type: 'assertions-updated',
            files: results.map((r) => r.file),
            process,
        });
        return results;
    }
    removeCachedResults(filePath) {
        this.testSuites.delete(filePath);
    }
    invalidateTestResults(filePath) {
        this.removeCachedResults(filePath);
        this.reconciler.removeTestFile(filePath);
    }
    // test stats
    getTestSuiteStats() {
        const stats = (0, helpers_1.emptyTestStats)();
        this.testSuites.forEach((suite) => {
            if (suite.status === 'KnownSuccess') {
                stats.success += 1;
            }
            else if (suite.status === 'KnownFail') {
                stats.fail += 1;
            }
            else {
                stats.unknown += 1;
            }
        });
        if (this.testFiles) {
            if (this.testFiles.length > stats.fail + stats.success + stats.unknown) {
                return Object.assign(Object.assign({}, stats), { unknown: this.testFiles.length - stats.fail - stats.success });
            }
        }
        return stats;
    }
    // snapshot support
    previewSnapshot(testPath, testFullName) {
        return this.snapshotProvider.previewSnapshot(testPath, testFullName);
    }
}
exports.TestResultProvider = TestResultProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVGVzdFJlc3VsdFByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL1Rlc3RSZXN1bHRzL1Rlc3RSZXN1bHRQcm92aWRlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSx1RUFBaUc7QUFDakcsNkNBQWdFO0FBQ2hFLDRDQUE0QztBQUc1Qyx3Q0FBNEM7QUFDNUMsNkRBQWdGO0FBQ2hGLDZDQUE2RDtBQUU3RCwyREFBd0Y7QUFDeEYsNkRBVTZCO0FBMkI3QixNQUFNLFlBQVksR0FBRyxDQUFDLENBQWEsRUFBRSxDQUFhLEVBQVUsRUFBRTtJQUM1RCxJQUFJLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLE1BQU0sRUFBRTtRQUN6QixPQUFPLENBQUMsQ0FBQztLQUNWO0lBQ0QsT0FBTyxpQ0FBb0IsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxHQUFHLGlDQUFvQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxVQUFVLENBQUM7QUFDL0YsQ0FBQyxDQUFDO0FBRUYsTUFBYSxlQUFlO0lBVTFCLFlBQ1MsUUFBZ0IsRUFDZixVQUEwQixFQUMxQixNQUFjO1FBRmYsYUFBUSxHQUFSLFFBQVEsQ0FBUTtRQUNmLGVBQVUsR0FBVixVQUFVLENBQWdCO1FBQzFCLFdBQU0sR0FBTixNQUFNLENBQVE7UUFFdEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxpREFBdUIsQ0FBQyxPQUFPLENBQUM7UUFDL0MsSUFBSSxDQUFDLFFBQVEsR0FBRyxFQUFFLENBQUM7SUFDckIsQ0FBQztJQUNELElBQVcsTUFBTTtRQUNmLE9BQU8sSUFBSSxDQUFDLE9BQU8sQ0FBQztJQUN0QixDQUFDO0lBQ0QsSUFBVyxPQUFPO1FBQ2hCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN2QixDQUFDO0lBQ0QsSUFBVyxPQUFPO1FBQ2hCLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQztJQUN2QixDQUFDO0lBQ0Qs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LElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLE9BQU8sR0FBRyxLQUFLLENBQUMsT0FBTyxFQUFFO2dCQUN0RSx1Q0FDSyxLQUFLLEtBQ1IsT0FBTyxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxHQUFHLEtBQUssQ0FBQyxJQUFJLEdBQUcsS0FBSyxDQUFDLE9BQU8sSUFDM0Q7YUFDSDtTQUNGO1FBQ0QsT0FBTyxLQUFLLENBQUM7SUFDZixDQUFDO0lBRUQsbUJBQW1CO0lBRVosZUFBZSxDQUFDLFFBQWdCLEVBQUUsWUFBb0I7UUFDM0QsT0FBTyxJQUFJLENBQUMsZ0JBQWdCLENBQUMsZUFBZSxDQUFDLFFBQVEsRUFBRSxZQUFZLENBQUMsQ0FBQztJQUN2RSxDQUFDO0NBQ0Y7QUExU0QsZ0RBMFNDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgVGVzdFJlY29uY2lsaWF0aW9uU3RhdGUsIFRlc3RSZWNvbmNpbGlhdGlvblN0YXRlVHlwZSB9IGZyb20gJy4vVGVzdFJlY29uY2lsaWF0aW9uU3RhdGUnO1xuaW1wb3J0IHsgVGVzdFJlc3VsdCwgVGVzdFJlc3VsdFN0YXR1c0luZm8gfSBmcm9tICcuL1Rlc3RSZXN1bHQnO1xuaW1wb3J0ICogYXMgbWF0Y2ggZnJvbSAnLi9tYXRjaC1ieS1jb250ZXh0JztcbmltcG9ydCB7IEplc3RTZXNzaW9uRXZlbnRzIH0gZnJvbSAnLi4vSmVzdEV4dCc7XG5pbXBvcnQgeyBUZXN0U3RhdHMgfSBmcm9tICcuLi90eXBlcyc7XG5pbXBvcnQgeyBlbXB0eVRlc3RTdGF0cyB9IGZyb20gJy4uL2hlbHBlcnMnO1xuaW1wb3J0IHsgY3JlYXRlVGVzdFJlc3VsdEV2ZW50cywgVGVzdFJlc3VsdEV2ZW50cyB9IGZyb20gJy4vdGVzdC1yZXN1bHQtZXZlbnRzJztcbmltcG9ydCB7IENvbnRhaW5lck5vZGUsIFJPT1RfTk9ERV9OQU1FIH0gZnJvbSAnLi9tYXRjaC1ub2RlJztcbmltcG9ydCB7IEplc3RQcm9jZXNzSW5mbyB9IGZyb20gJy4uL0plc3RQcm9jZXNzTWFuYWdlbWVudCc7XG5pbXBvcnQgeyBFeHRTbmFwc2hvdEJsb2NrLCBTbmFwc2hvdFByb3ZpZGVyLCBTbmFwc2hvdFN1aXRlIH0gZnJvbSAnLi9zbmFwc2hvdC1wcm92aWRlcic7XG5pbXBvcnQge1xuICBUZXN0UmVjb25jaWxlcixcbiAgSmVzdFRvdGFsUmVzdWx0cyxcbiAgVGVzdEZpbGVBc3NlcnRpb25TdGF0dXMsXG4gIElQYXJzZVJlc3VsdHMsXG4gIHBhcnNlLFxuICBUZXN0QXNzZXJ0aW9uU3RhdHVzLFxuICBQYXJzZWRSYW5nZSxcbiAgSXRCbG9jayxcbiAgU25hcHNob3RQYXJzZXJPcHRpb25zLFxufSBmcm9tICdqZXN0LWVkaXRvci1zdXBwb3J0JztcblxudHlwZSBUZXN0QmxvY2tzID0gSVBhcnNlUmVzdWx0cyAmIHsgc291cmNlQ29udGFpbmVyOiBDb250YWluZXJOb2RlPEl0QmxvY2s+IH07XG5pbnRlcmZhY2UgVGVzdFN1aXRlUGFyc2VSZXN1bHRSYXcge1xuICB0ZXN0QmxvY2tzOiBUZXN0QmxvY2tzIHwgJ2ZhaWxlZCc7XG59XG5pbnRlcmZhY2UgVGVzdFN1aXRlUmVzdWx0UmF3IHtcbiAgc3RhdHVzOiBUZXN0UmVjb25jaWxpYXRpb25TdGF0ZVR5cGU7XG4gIG1lc3NhZ2U6IHN0cmluZztcbiAgYXNzZXJ0aW9uQ29udGFpbmVyPzogQ29udGFpbmVyTm9kZTxUZXN0QXNzZXJ0aW9uU3RhdHVzPjtcbiAgcmVzdWx0cz86IFRlc3RSZXN1bHRbXTtcbiAgc29ydGVkPzogU29ydGVkVGVzdFJlc3VsdHM7XG4gIC8vIGlmIHdlIGFyZSBjZXJ0YWluIHRoZSByZWNvcmQgaXMgZm9yIGEgdGVzdCBmaWxlLCBzZXQgdGhpcyBmbGFnIHRvIHRydWVcbiAgLy8gb3RoZXJ3aXNlIGlzVGVzdEZpbGUgaXMgZGV0ZXJtaW5lZCBieSB0aGUgdGVzdEZpbGVMaXN0XG4gIGlzVGVzdEZpbGU/OiBib29sZWFuO1xufVxuXG5leHBvcnQgdHlwZSBUZXN0U3VpdGVSZXN1bHQgPSBSZWFkb25seTxUZXN0U3VpdGVSZXN1bHRSYXc+O1xudHlwZSBUZXN0U3VpdGVVcGRhdGFibGUgPSBSZWFkb25seTxUZXN0U3VpdGVSZXN1bHRSYXcgJiBUZXN0U3VpdGVQYXJzZVJlc3VsdFJhdz47XG5cbmV4cG9ydCBpbnRlcmZhY2UgU29ydGVkVGVzdFJlc3VsdHMge1xuICBmYWlsOiBUZXN0UmVzdWx0W107XG4gIHNraXA6IFRlc3RSZXN1bHRbXTtcbiAgc3VjY2VzczogVGVzdFJlc3VsdFtdO1xuICB1bmtub3duOiBUZXN0UmVzdWx0W107XG59XG5cbmNvbnN0IHNvcnRCeVN0YXR1cyA9IChhOiBUZXN0UmVzdWx0LCBiOiBUZXN0UmVzdWx0KTogbnVtYmVyID0+IHtcbiAgaWYgKGEuc3RhdHVzID09PSBiLnN0YXR1cykge1xuICAgIHJldHVybiAwO1xuICB9XG4gIHJldHVybiBUZXN0UmVzdWx0U3RhdHVzSW5mb1thLnN0YXR1c10ucHJlY2VkZW5jZSAtIFRlc3RSZXN1bHRTdGF0dXNJbmZvW2Iuc3RhdHVzXS5wcmVjZWRlbmNlO1xufTtcblxuZXhwb3J0IGNsYXNzIFRlc3RTdWl0ZVJlY29yZCBpbXBsZW1lbnRzIFRlc3RTdWl0ZVVwZGF0YWJsZSB7XG4gIHByaXZhdGUgX3N0YXR1czogVGVzdFJlY29uY2lsaWF0aW9uU3RhdGVUeXBlO1xuICBwcml2YXRlIF9tZXNzYWdlOiBzdHJpbmc7XG4gIHByaXZhdGUgX3Jlc3VsdHM/OiBUZXN0UmVzdWx0W107XG4gIHByaXZhdGUgX3NvcnRlZD86IFNvcnRlZFRlc3RSZXN1bHRzO1xuICBwcml2YXRlIF9pc1Rlc3RGaWxlPzogYm9vbGVhbjtcblxuICBwcml2YXRlIF90ZXN0QmxvY2tzPzogVGVzdEJsb2NrcyB8ICdmYWlsZWQnO1xuICBwcml2YXRlIF9hc3NlcnRpb25Db250YWluZXI/OiBDb250YWluZXJOb2RlPFRlc3RBc3NlcnRpb25TdGF0dXM+O1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHB1YmxpYyB0ZXN0RmlsZTogc3RyaW5nLFxuICAgIHByaXZhdGUgcmVjb25jaWxlcjogVGVzdFJlY29uY2lsZXIsXG4gICAgcHJpdmF0ZSBwYXJzZXI6IFBhcnNlclxuICApIHtcbiAgICB0aGlzLl9zdGF0dXMgPSBUZXN0UmVjb25jaWxpYXRpb25TdGF0ZS5Vbmtub3duO1xuICAgIHRoaXMuX21lc3NhZ2UgPSAnJztcbiAgfVxuICBwdWJsaWMgZ2V0IHN0YXR1cygpOiBUZXN0UmVjb25jaWxpYXRpb25TdGF0ZVR5cGUge1xuICAgIHJldHVybiB0aGlzLl9zdGF0dXM7XG4gIH1cbiAgcHVibGljIGdldCBtZXNzYWdlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuX21lc3NhZ2U7XG4gIH1cbiAgcHVibGljIGdldCByZXN1bHRzKCk6IFRlc3RSZXN1bHRbXSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc3VsdHM7XG4gIH1cbiAgcHVibGljIGdldCBzb3J0ZWQoKTogU29ydGVkVGVzdFJlc3VsdHMgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLl9zb3J0ZWQ7XG4gIH1cbiAgcHVibGljIGdldCBpc1Rlc3RGaWxlKCk6IGJvb2xlYW4gfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLl9pc1Rlc3RGaWxlO1xuICB9XG5cbiAgLyoqXG4gICAqIHBhcnNlIHRlc3QgZmlsZSBhbmQgY3JlYXRlIHNvdXJjZUNvbnRhaW5lciwgaWYgbmVlZGVkLlxuICAgKiBAcmV0dXJucyBUZXN0QmxvY2tzIHwgJ2ZhaWxlZCdcbiAgICovXG4gIHB1YmxpYyBnZXQgdGVzdEJsb2NrcygpOiBUZXN0QmxvY2tzIHwgJ2ZhaWxlZCcge1xuICAgIGlmICghdGhpcy5fdGVzdEJsb2Nrcykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcFJlc3VsdCA9IHRoaXMucGFyc2VyLnBhcnNlVGVzdEZpbGUodGhpcy50ZXN0RmlsZSk7XG4gICAgICAgIGlmICghW3BSZXN1bHQuZGVzY3JpYmVCbG9ja3MsIHBSZXN1bHQuaXRCbG9ja3NdLmZpbmQoKGJsb2NrcykgPT4gYmxvY2tzLmxlbmd0aCA+IDApKSB7XG4gICAgICAgICAgLy8gbm90aGluZyBpbiB0aGlzIGZpbGUgeWV0LCBza2lwLiBPdGhlcndpc2Ugd2UgbWlnaHQgYWNjaWRlbnRhbGx5IHB1Ymxpc2ggYSBzb3VyY2UgZmlsZSwgZm9yIGV4YW1wbGVcbiAgICAgICAgICByZXR1cm4gJ2ZhaWxlZCc7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc291cmNlQ29udGFpbmVyID0gbWF0Y2guYnVpbGRTb3VyY2VDb250YWluZXIocFJlc3VsdC5yb290KTtcbiAgICAgICAgdGhpcy5fdGVzdEJsb2NrcyA9IHsgLi4ucFJlc3VsdCwgc291cmNlQ29udGFpbmVyIH07XG5cbiAgICAgICAgY29uc3Qgc25hcHNob3RCbG9ja3MgPSB0aGlzLnBhcnNlci5wYXJzZVNuYXBzaG90KHRoaXMudGVzdEZpbGUpLmJsb2NrcztcbiAgICAgICAgaWYgKHNuYXBzaG90QmxvY2tzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZVNuYXBzaG90QXR0cihzb3VyY2VDb250YWluZXIsIHNuYXBzaG90QmxvY2tzKTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICAvLyBub3JtYWwgdG8gZmFpbCwgZm9yIGV4YW1wbGUgd2hlbiBzb3VyY2UgZmlsZSBoYXMgc3ludGF4IGVycm9yXG4gICAgICAgIGlmICh0aGlzLnBhcnNlci5vcHRpb25zPy52ZXJib3NlKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coYHBhcnNlVGVzdEJsb2NrcyBmYWlsZWQgZm9yICR7dGhpcy50ZXN0RmlsZX1gLCBlKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl90ZXN0QmxvY2tzID0gJ2ZhaWxlZCc7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuX3Rlc3RCbG9ja3MgPz8gJ2ZhaWxlZCc7XG4gIH1cblxuICBwdWJsaWMgZ2V0IGFzc2VydGlvbkNvbnRhaW5lcigpOiBDb250YWluZXJOb2RlPFRlc3RBc3NlcnRpb25TdGF0dXM+IHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIXRoaXMuX2Fzc2VydGlvbkNvbnRhaW5lcikge1xuICAgICAgY29uc3QgYXNzZXJ0aW9ucyA9IHRoaXMucmVjb25jaWxlci5hc3NlcnRpb25zRm9yVGVzdEZpbGUodGhpcy50ZXN0RmlsZSk7XG4gICAgICBpZiAoYXNzZXJ0aW9ucyAmJiBhc3NlcnRpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgdGhpcy5fYXNzZXJ0aW9uQ29udGFpbmVyID0gbWF0Y2guYnVpbGRBc3NlcnRpb25Db250YWluZXIoYXNzZXJ0aW9ucyk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLl9hc3NlcnRpb25Db250YWluZXI7XG4gIH1cblxuICBwcml2YXRlIHVwZGF0ZVNuYXBzaG90QXR0cihcbiAgICBjb250YWluZXI6IENvbnRhaW5lck5vZGU8SXRCbG9jaz4sXG4gICAgc25hcHNob3RzOiBFeHRTbmFwc2hvdEJsb2NrW11cbiAgKTogdm9pZCB7XG4gICAgY29uc3QgaXNXaXRoaW4gPSAoc25hcHNob3Q6IEV4dFNuYXBzaG90QmxvY2ssIHJhbmdlPzogUGFyc2VkUmFuZ2UpOiBib29sZWFuID0+IHtcbiAgICAgIGNvbnN0IHplcm9CYXNlZExpbmUgPSBzbmFwc2hvdC5ub2RlLmxvYy5zdGFydC5saW5lIC0gMTtcbiAgICAgIHJldHVybiAhIXJhbmdlICYmIHJhbmdlLnN0YXJ0LmxpbmUgPD0gemVyb0Jhc2VkTGluZSAmJiByYW5nZS5lbmQubGluZSA+PSB6ZXJvQmFzZWRMaW5lO1xuICAgIH07XG5cbiAgICBpZiAoXG4gICAgICBjb250YWluZXIubmFtZSAhPT0gUk9PVF9OT0RFX05BTUUgJiZcbiAgICAgIGNvbnRhaW5lci5hdHRycy5yYW5nZSAmJlxuICAgICAgIXNuYXBzaG90cy5maW5kKChzKSA9PiBpc1dpdGhpbihzLCBjb250YWluZXIuYXR0cnMucmFuZ2UpKVxuICAgICkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb250YWluZXIuY2hpbGREYXRhLmZvckVhY2goKGJsb2NrKSA9PiB7XG4gICAgICBjb25zdCBzbmFwc2hvdCA9IHNuYXBzaG90cy5maW5kKChzKSA9PiBpc1dpdGhpbihzLCBibG9jay5hdHRycy5yYW5nZSkpO1xuICAgICAgaWYgKHNuYXBzaG90KSB7XG4gICAgICAgIGJsb2NrLmF0dHJzLnNuYXBzaG90ID0gc25hcHNob3QuaXNJbmxpbmUgPyAnaW5saW5lJyA6ICdleHRlcm5hbCc7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29udGFpbmVyLmNoaWxkQ29udGFpbmVycy5mb3JFYWNoKChjaGlsZENvbnRhaW5lcikgPT5cbiAgICAgIHRoaXMudXBkYXRlU25hcHNob3RBdHRyKGNoaWxkQ29udGFpbmVyLCBzbmFwc2hvdHMpXG4gICAgKTtcbiAgfVxuXG4gIHB1YmxpYyB1cGRhdGUoY2hhbmdlOiBQYXJ0aWFsPFRlc3RTdWl0ZVVwZGF0YWJsZT4pOiB2b2lkIHtcbiAgICB0aGlzLl9zdGF0dXMgPSBjaGFuZ2Uuc3RhdHVzID8/IHRoaXMuc3RhdHVzO1xuICAgIHRoaXMuX21lc3NhZ2UgPSBjaGFuZ2UubWVzc2FnZSA/PyB0aGlzLm1lc3NhZ2U7XG5cbiAgICB0aGlzLl9pc1Rlc3RGaWxlID0gJ2lzVGVzdEZpbGUnIGluIGNoYW5nZSA/IGNoYW5nZS5pc1Rlc3RGaWxlIDogdGhpcy5faXNUZXN0RmlsZTtcbiAgICB0aGlzLl9yZXN1bHRzID0gJ3Jlc3VsdHMnIGluIGNoYW5nZSA/IGNoYW5nZS5yZXN1bHRzIDogdGhpcy5fcmVzdWx0cztcbiAgICB0aGlzLl9zb3J0ZWQgPSAnc29ydGVkJyBpbiBjaGFuZ2UgPyBjaGFuZ2Uuc29ydGVkIDogdGhpcy5fc29ydGVkO1xuICAgIHRoaXMuX2Fzc2VydGlvbkNvbnRhaW5lciA9XG4gICAgICAnYXNzZXJ0aW9uQ29udGFpbmVyJyBpbiBjaGFuZ2UgPyBjaGFuZ2UuYXNzZXJ0aW9uQ29udGFpbmVyIDogdGhpcy5fYXNzZXJ0aW9uQ29udGFpbmVyO1xuICB9XG59XG5leHBvcnQgdHlwZSBUZXN0UmVzdWx0UHJvdmlkZXJPcHRpb25zID0gU25hcHNob3RQYXJzZXJPcHRpb25zO1xuXG5jbGFzcyBQYXJzZXIge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHNuYXBzaG90UHJvdmlkZXI6IFNuYXBzaG90UHJvdmlkZXIsXG4gICAgcHVibGljIG9wdGlvbnM/OiBUZXN0UmVzdWx0UHJvdmlkZXJPcHRpb25zXG4gICkge31cbiAgcHVibGljIHBhcnNlU25hcHNob3QodGVzdFBhdGg6IHN0cmluZyk6IFNuYXBzaG90U3VpdGUge1xuICAgIGNvbnN0IHJlcyA9IHRoaXMuc25hcHNob3RQcm92aWRlci5wYXJzZSh0ZXN0UGF0aCwgdGhpcy5vcHRpb25zKTtcbiAgICByZXR1cm4gcmVzO1xuICB9XG5cbiAgcHVibGljIHBhcnNlVGVzdEZpbGUodGVzdFBhdGg6IHN0cmluZyk6IElQYXJzZVJlc3VsdHMge1xuICAgIGNvbnN0IHJlcyA9IHBhcnNlKHRlc3RQYXRoLCB1bmRlZmluZWQsIHRoaXMub3B0aW9ucz8ucGFyc2VyT3B0aW9ucyk7XG4gICAgcmV0dXJuIHJlcztcbiAgfVxufVxuZXhwb3J0IGNsYXNzIFRlc3RSZXN1bHRQcm92aWRlciB7XG4gIHByaXZhdGUgX29wdGlvbnM6IFRlc3RSZXN1bHRQcm92aWRlck9wdGlvbnM7XG4gIGV2ZW50czogVGVzdFJlc3VsdEV2ZW50cztcbiAgcHJpdmF0ZSByZWNvbmNpbGVyOiBUZXN0UmVjb25jaWxlcjtcbiAgcHJpdmF0ZSB0ZXN0U3VpdGVzOiBNYXA8c3RyaW5nLCBUZXN0U3VpdGVSZWNvcmQ+O1xuICBwcml2YXRlIHRlc3RGaWxlcz86IHN0cmluZ1tdO1xuICBwcml2YXRlIHNuYXBzaG90UHJvdmlkZXI6IFNuYXBzaG90UHJvdmlkZXI7XG4gIHByaXZhdGUgcGFyc2VyOiBQYXJzZXI7XG5cbiAgY29uc3RydWN0b3IoXG4gICAgZXh0RXZlbnRzOiBKZXN0U2Vzc2lvbkV2ZW50cyxcbiAgICBvcHRpb25zOiBUZXN0UmVzdWx0UHJvdmlkZXJPcHRpb25zID0geyB2ZXJib3NlOiBmYWxzZSB9XG4gICkge1xuICAgIHRoaXMucmVjb25jaWxlciA9IG5ldyBUZXN0UmVjb25jaWxlcigpO1xuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMuZXZlbnRzID0gY3JlYXRlVGVzdFJlc3VsdEV2ZW50cygpO1xuICAgIHRoaXMudGVzdFN1aXRlcyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLnNuYXBzaG90UHJvdmlkZXIgPSBuZXcgU25hcHNob3RQcm92aWRlcigpO1xuICAgIHRoaXMucGFyc2VyID0gbmV3IFBhcnNlcih0aGlzLnNuYXBzaG90UHJvdmlkZXIsIHRoaXMuX29wdGlvbnMpO1xuICAgIGV4dEV2ZW50cy5vblRlc3RTZXNzaW9uU3RhcnRlZC5ldmVudCh0aGlzLm9uU2Vzc2lvblN0YXJ0LmJpbmQodGhpcykpO1xuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLmV2ZW50cy50ZXN0TGlzdFVwZGF0ZWQuZGlzcG9zZSgpO1xuICAgIHRoaXMuZXZlbnRzLnRlc3RTdWl0ZUNoYW5nZWQuZGlzcG9zZSgpO1xuICB9XG5cbiAgc2V0IG9wdGlvbnMob3B0aW9uczogVGVzdFJlc3VsdFByb3ZpZGVyT3B0aW9ucykge1xuICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMucGFyc2VyLm9wdGlvbnMgPSB0aGlzLl9vcHRpb25zO1xuICAgIHRoaXMudGVzdFN1aXRlcy5jbGVhcigpO1xuICB9XG5cbiAgcHJpdmF0ZSBhZGRUZXN0U3VpdGVSZWNvcmQodGVzdEZpbGU6IHN0cmluZyk6IFRlc3RTdWl0ZVJlY29yZCB7XG4gICAgY29uc3QgcmVjb3JkID0gbmV3IFRlc3RTdWl0ZVJlY29yZCh0ZXN0RmlsZSwgdGhpcy5yZWNvbmNpbGVyLCB0aGlzLnBhcnNlcik7XG4gICAgdGhpcy50ZXN0U3VpdGVzLnNldCh0ZXN0RmlsZSwgcmVjb3JkKTtcbiAgICByZXR1cm4gcmVjb3JkO1xuICB9XG4gIHByaXZhdGUgb25TZXNzaW9uU3RhcnQoKTogdm9pZCB7XG4gICAgdGhpcy50ZXN0U3VpdGVzLmNsZWFyKCk7XG4gICAgdGhpcy5yZWNvbmNpbGVyID0gbmV3IFRlc3RSZWNvbmNpbGVyKCk7XG4gIH1cblxuICBwcml2YXRlIGdyb3VwQnlSYW5nZShyZXN1bHRzOiBUZXN0UmVzdWx0W10pOiBUZXN0UmVzdWx0W10ge1xuICAgIGlmICghcmVzdWx0cy5sZW5ndGgpIHtcbiAgICAgIHJldHVybiByZXN1bHRzO1xuICAgIH1cbiAgICAvLyBidWlsZCBhIHJhbmdlIGJhc2VkIG1hcFxuICAgIGNvbnN0IGJ5UmFuZ2U6IE1hcDxzdHJpbmcsIFRlc3RSZXN1bHRbXT4gPSBuZXcgTWFwKCk7XG4gICAgcmVzdWx0cy5mb3JFYWNoKChyKSA9PiB7XG4gICAgICAvLyBROiBpcyB0aGVyZSBhIGJldHRlci9lZmZpY2llbnQgd2F5IHRvIGluZGV4IHRoZSByYW5nZT9cbiAgICAgIGNvbnN0IGtleSA9IGAke3Iuc3RhcnQubGluZX0tJHtyLnN0YXJ0LmNvbHVtbn0tJHtyLmVuZC5saW5lfS0ke3IuZW5kLmNvbHVtbn1gO1xuICAgICAgY29uc3QgbGlzdCA9IGJ5UmFuZ2UuZ2V0KGtleSk7XG4gICAgICBpZiAoIWxpc3QpIHtcbiAgICAgICAgYnlSYW5nZS5zZXQoa2V5LCBbcl0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbGlzdC5wdXNoKHIpO1xuICAgICAgfVxuICAgIH0pO1xuICAgIC8vIHNvcnQgdGhlIHRlc3QgYnkgc3RhdHVzIHByZWNlZGVuY2VcbiAgICBieVJhbmdlLmZvckVhY2goKGxpc3QpID0+IGxpc3Quc29ydChzb3J0QnlTdGF0dXMpKTtcblxuICAgIC8vbWVyZ2UgbXVsdGlSZXN1bHRzIHVuZGVyIHRoZSBwcmltYXJ5IChoaWdoZXN0IHByZWNlZGVuY2UpXG4gICAgY29uc3QgY29uc29saWRhdGVkOiBUZXN0UmVzdWx0W10gPSBbXTtcbiAgICBieVJhbmdlLmZvckVhY2goKGxpc3QpID0+IHtcbiAgICAgIGlmIChsaXN0Lmxlbmd0aCA+IDEpIHtcbiAgICAgICAgbGlzdFswXS5tdWx0aVJlc3VsdHMgPSBsaXN0LnNsaWNlKDEpO1xuICAgICAgfVxuICAgICAgY29uc29saWRhdGVkLnB1c2gobGlzdFswXSk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGNvbnNvbGlkYXRlZDtcbiAgfVxuXG4gIHVwZGF0ZVRlc3RGaWxlTGlzdCh0ZXN0RmlsZXM/OiBzdHJpbmdbXSk6IHZvaWQge1xuICAgIHRoaXMudGVzdEZpbGVzID0gdGVzdEZpbGVzO1xuXG4gICAgLy8gY2xlYXIgdGhlIGNhY2hlIGluIGNhc2Ugd2UgaGF2ZSBjYWNoZWQgc29tZSBub24tdGVzdCBmaWxlcyBwcmlvclxuICAgIHRoaXMudGVzdFN1aXRlcy5jbGVhcigpO1xuXG4gICAgdGhpcy5ldmVudHMudGVzdExpc3RVcGRhdGVkLmZpcmUodGVzdEZpbGVzKTtcbiAgfVxuICBnZXRUZXN0TGlzdCgpOiBzdHJpbmdbXSB7XG4gICAgaWYgKHRoaXMudGVzdEZpbGVzICYmIHRoaXMudGVzdEZpbGVzLmxlbmd0aCA+IDApIHtcbiAgICAgIHJldHVybiB0aGlzLnRlc3RGaWxlcztcbiAgICB9XG4gICAgcmV0dXJuIEFycmF5LmZyb20odGhpcy50ZXN0U3VpdGVzLmtleXMoKSkuZmlsdGVyKChmKSA9PiB0aGlzLmlzVGVzdEZpbGUoZikpO1xuICB9XG5cbiAgaXNUZXN0RmlsZShmaWxlTmFtZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc29sZS5lcnJvcignMScpO1xuICAgIGlmICh0aGlzLnRlc3RGaWxlcz8uaW5jbHVkZXMoZmlsZU5hbWUpIHx8IHRoaXMudGVzdFN1aXRlcy5nZXQoZmlsZU5hbWUpPy5pc1Rlc3RGaWxlKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgY29uc29sZS5lcnJvcignMicpO1xuXG4gICAgLy9pZiB3ZSBhbHJlYWR5IGhhdmUgdGVzdEZpbGVzLCB0aGVuIHdlIGNhbiBiZSBjZXJ0YWluIHRoYXQgdGhlIGZpbGUgaXMgbm90IGEgdGVzdCBmaWxlXG4gICAgaWYgKHRoaXMudGVzdEZpbGVzKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnNvbGUuZXJyb3IoJzMnKTtcblxuICAgIGNvbnN0IF9yZWNvcmQgPSB0aGlzLnRlc3RTdWl0ZXMuZ2V0KGZpbGVOYW1lKSA/PyB0aGlzLmFkZFRlc3RTdWl0ZVJlY29yZChmaWxlTmFtZSk7XG4gICAgaWYgKF9yZWNvcmQuaXNUZXN0RmlsZSA9PT0gZmFsc2UpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBjb25zb2xlLmVycm9yKCc0Jyk7XG5cbiAgICAvLyBjaGVjayBpZiB0aGUgZmlsZSBpcyBhIHRlc3QgZmlsZSBieSBwYXJzaW5nIHRoZSBjb250ZW50XG4gICAgY29uc3QgaXNUZXN0RmlsZSA9IF9yZWNvcmQudGVzdEJsb2NrcyAhPT0gJ2ZhaWxlZCc7XG4gICAgX3JlY29yZC51cGRhdGUoeyBpc1Rlc3RGaWxlIH0pO1xuICAgIGNvbnNvbGUuZXJyb3IoJzUnKTtcbiAgICByZXR1cm4gaXNUZXN0RmlsZTtcbiAgfVxuXG4gIHB1YmxpYyBnZXRUZXN0U3VpdGVSZXN1bHQoZmlsZVBhdGg6IHN0cmluZyk6IFRlc3RTdWl0ZVJlc3VsdCB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMudGVzdFN1aXRlcy5nZXQoZmlsZVBhdGgpO1xuICB9XG5cbiAgLyoqXG4gICAqIG1hdGNoIGFzc2VydGlvbnMgd2l0aCBzb3VyY2UgZmlsZSwgaWYgc3VjY2Vzc2Z1bCwgdXBkYXRlIGNhY2hlLCByZXN1bHRzIGFuZCByZWxhdGVkLlxuICAgKiBXaWxsIGFsc28gZmlyZSB0ZXN0U3VpdGVDaGFuZ2VkIGV2ZW50XG4gICAqXG4gICAqIGlmIHRoZSBmaWxlIGlzIG5vdCBhIHRlc3Qgb3IgY2FuIG5vdCBiZSBwYXJzZWQsIHRoZSByZXN1bHRzIHdpbGwgYmUgdW5kZWZpbmVkLlxuICAgKiBhbnkgb3RoZXIgZXJyb3JzIHdpbGwgcmVzdWx0IHRoZSBzb3VyY2UgYmxvY2tzIHRvIGJlIHJldHVybmVkIGFzIHVubWF0Y2hlZCBibG9jay5cbiAgICoqL1xuICBwcml2YXRlIHVwZGF0ZU1hdGNoZWRSZXN1bHRzKGZpbGVQYXRoOiBzdHJpbmcsIHJlY29yZDogVGVzdFN1aXRlUmVjb3JkKTogdm9pZCB7XG4gICAgbGV0IGVycm9yOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHN0YXR1cyA9IHJlY29yZC5zdGF0dXM7XG4gICAgLy8gbWFrZSBzdXJlIHdlIGRvIG5vdCBmaXJlIGNoYW5nZUV2ZW50IHNpbmNlIHRoYXQgd2lsbCBiZSBwcm9jZWVkZWQgd2l0aCBtYXRjaCBvciB1bm1hdGNoZWQgZXZlbnQgYW55d2F5XG4gICAgY29uc3QgdGVzdEJsb2NrcyA9IHJlY29yZC50ZXN0QmxvY2tzO1xuICAgIGlmICh0ZXN0QmxvY2tzID09PSAnZmFpbGVkJykge1xuICAgICAgcmVjb3JkLnVwZGF0ZSh7IHN0YXR1czogJ0tub3duRmFpbCcsIG1lc3NhZ2U6ICd0ZXN0IGZpbGUgcGFyc2UgZXJyb3InLCByZXN1bHRzOiBbXSB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB7IGl0QmxvY2tzIH0gPSB0ZXN0QmxvY2tzO1xuICAgIGlmIChyZWNvcmQuYXNzZXJ0aW9uQ29udGFpbmVyKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCByZXN1bHRzID0gdGhpcy5ncm91cEJ5UmFuZ2UoXG4gICAgICAgICAgbWF0Y2gubWF0Y2hUZXN0QXNzZXJ0aW9ucyhcbiAgICAgICAgICAgIGZpbGVQYXRoLFxuICAgICAgICAgICAgdGVzdEJsb2Nrcy5zb3VyY2VDb250YWluZXIsXG4gICAgICAgICAgICByZWNvcmQuYXNzZXJ0aW9uQ29udGFpbmVyLFxuICAgICAgICAgICAgdGhpcy5fb3B0aW9ucy52ZXJib3NlXG4gICAgICAgICAgKVxuICAgICAgICApO1xuICAgICAgICByZWNvcmQudXBkYXRlKHsgcmVzdWx0cyB9KTtcblxuICAgICAgICB0aGlzLmV2ZW50cy50ZXN0U3VpdGVDaGFuZ2VkLmZpcmUoe1xuICAgICAgICAgIHR5cGU6ICdyZXN1bHQtbWF0Y2hlZCcsXG4gICAgICAgICAgZmlsZTogZmlsZVBhdGgsXG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNvbnNvbGUud2FybihgZmFpbGVkIHRvIG1hdGNoIHRlc3QgcmVzdWx0cyBmb3IgJHtmaWxlUGF0aH06YCwgZSk7XG4gICAgICAgIGVycm9yID0gYGVuY291bnRlcmVkIGludGVybmFsIG1hdGNoIGVycm9yOiAke2V9YDtcbiAgICAgICAgc3RhdHVzID0gJ0tub3duRmFpbCc7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIHRoZXJlIG1pZ2h0IGJlIG1hbnkgcmVhc29ucyBmb3IgdGhpcywgZm9yIGV4YW1wbGUgdGhlIHRlc3QgaXMgbm90IHlldCBydW4sIHNvIGxlYXZlIGl0IGFzIHVua25vd25cbiAgICAgIGVycm9yID0gJ25vIGFzc2VydGlvbiBnZW5lcmF0ZWQgZm9yIGZpbGUnO1xuICAgIH1cblxuICAgIC8vIG5vIG5lZWQgdG8gZG8gZ3JvdXBCeVJhbmdlIGFzIHRoZSBzb3VyY2UgYmxvY2sgd2lsbCBub3QgaGF2ZSBibG9ja3MgdW5kZXIgdGhlIHNhbWUgbG9jYXRpb25cbiAgICByZWNvcmQudXBkYXRlKHtcbiAgICAgIHN0YXR1cyxcbiAgICAgIG1lc3NhZ2U6IGVycm9yLFxuICAgICAgcmVzdWx0czogaXRCbG9ja3MubWFwKCh0KSA9PiBtYXRjaC50b01hdGNoUmVzdWx0KHQsICdubyBhc3NlcnRpb24gZm91bmQnLCAnbWF0Y2gtZmFpbGVkJykpLFxuICAgIH0pO1xuXG4gICAgLy8gZmlsZSBtYXRjaCBmYWlsZWQgZXZlbnQgc28gdGhlIGxpc3RlbmVycyBjYW4gZGlzcGxheSB0aGUgc291cmNlIGJsb2NrcyBpbnN0ZWFkXG4gICAgdGhpcy5ldmVudHMudGVzdFN1aXRlQ2hhbmdlZC5maXJlKHtcbiAgICAgIHR5cGU6ICdyZXN1bHQtbWF0Y2gtZmFpbGVkJyxcbiAgICAgIGZpbGU6IGZpbGVQYXRoLFxuICAgICAgc291cmNlQ29udGFpbmVyOiB0ZXN0QmxvY2tzLnNvdXJjZUNvbnRhaW5lcixcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiByZXR1cm5zIG1hdGNoZWQgdGVzdCByZXN1bHRzIGZvciB0aGUgZ2l2ZW4gZmlsZVxuICAgKiBAcGFyYW0gZmlsZVBhdGhcbiAgICogQHJldHVybnMgdmFsaWQgdGVzdCByZXN1bHQgbGlzdCBvciBhbiBlbXB0eSBhcnJheSBpZiB0aGUgc291cmNlIGZpbGUgaXMgbm90IGEgdGVzdCBvciBjYW4gbm90IGJlIHBhcnNlZC5cbiAgICovXG4gIGdldFJlc3VsdHMoZmlsZVBhdGg6IHN0cmluZywgcmVjb3JkPzogVGVzdFN1aXRlUmVjb3JkKTogVGVzdFJlc3VsdFtdIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAoIXRoaXMuaXNUZXN0RmlsZShmaWxlUGF0aCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBfcmVjb3JkID0gcmVjb3JkID8/IHRoaXMudGVzdFN1aXRlcy5nZXQoZmlsZVBhdGgpID8/IHRoaXMuYWRkVGVzdFN1aXRlUmVjb3JkKGZpbGVQYXRoKTtcbiAgICBpZiAoX3JlY29yZC5yZXN1bHRzKSB7XG4gICAgICByZXR1cm4gX3JlY29yZC5yZXN1bHRzO1xuICAgIH1cblxuICAgIHRoaXMudXBkYXRlTWF0Y2hlZFJlc3VsdHMoZmlsZVBhdGgsIF9yZWNvcmQpO1xuICAgIHJldHVybiBfcmVjb3JkLnJlc3VsdHM7XG4gIH1cblxuICAvKipcbiAgICogcmV0dXJucyBzb3J0ZWQgdGVzdCByZXN1bHRzIGZvciB0aGUgZ2l2ZW4gZmlsZVxuICAgKiBAcGFyYW0gZmlsZVBhdGhcbiAgICogQHJldHVybnMgdmFsaWQgc29ydGVkIHRlc3QgcmVzdWx0IG9yIHVuZGVmaW5lZCBpZiB0aGUgZmlsZSBpcyBub3QgYSB0ZXN0LlxuICAgKi9cblxuICBnZXRTb3J0ZWRSZXN1bHRzKGZpbGVQYXRoOiBzdHJpbmcpOiBTb3J0ZWRUZXN0UmVzdWx0cyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKCF0aGlzLmlzVGVzdEZpbGUoZmlsZVBhdGgpKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcmVjb3JkID0gdGhpcy50ZXN0U3VpdGVzLmdldChmaWxlUGF0aCkgPz8gdGhpcy5hZGRUZXN0U3VpdGVSZWNvcmQoZmlsZVBhdGgpO1xuICAgIGlmIChyZWNvcmQuc29ydGVkKSB7XG4gICAgICByZXR1cm4gcmVjb3JkLnNvcnRlZDtcbiAgICB9XG5cbiAgICBjb25zdCBzb3J0ZWQ6IFNvcnRlZFRlc3RSZXN1bHRzID0ge1xuICAgICAgZmFpbDogW10sXG4gICAgICBza2lwOiBbXSxcbiAgICAgIHN1Y2Nlc3M6IFtdLFxuICAgICAgdW5rbm93bjogW10sXG4gICAgfTtcblxuICAgIGNvbnN0IHRlc3RSZXN1bHRzID0gdGhpcy5nZXRSZXN1bHRzKGZpbGVQYXRoLCByZWNvcmQpO1xuICAgIGlmICghdGVzdFJlc3VsdHMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCB0ZXN0IG9mIHRlc3RSZXN1bHRzKSB7XG4gICAgICBpZiAodGVzdC5zdGF0dXMgPT09IFRlc3RSZWNvbmNpbGlhdGlvblN0YXRlLktub3duRmFpbCkge1xuICAgICAgICBzb3J0ZWQuZmFpbC5wdXNoKHRlc3QpO1xuICAgICAgfSBlbHNlIGlmICh0ZXN0LnN0YXR1cyA9PT0gVGVzdFJlY29uY2lsaWF0aW9uU3RhdGUuS25vd25Ta2lwKSB7XG4gICAgICAgIHNvcnRlZC5za2lwLnB1c2godGVzdCk7XG4gICAgICB9IGVsc2UgaWYgKHRlc3Quc3RhdHVzID09PSBUZXN0UmVjb25jaWxpYXRpb25TdGF0ZS5Lbm93blN1Y2Nlc3MpIHtcbiAgICAgICAgc29ydGVkLnN1Y2Nlc3MucHVzaCh0ZXN0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHNvcnRlZC51bmtub3duLnB1c2godGVzdCk7XG4gICAgICB9XG4gICAgfVxuICAgIHJlY29yZC51cGRhdGUoeyBzb3J0ZWQgfSk7XG4gICAgcmV0dXJuIHNvcnRlZDtcbiAgfVxuXG4gIHVwZGF0ZVRlc3RSZXN1bHRzKGRhdGE6IEplc3RUb3RhbFJlc3VsdHMsIHByb2Nlc3M6IEplc3RQcm9jZXNzSW5mbyk6IFRlc3RGaWxlQXNzZXJ0aW9uU3RhdHVzW10ge1xuICAgIGNvbnN0IHJlc3VsdHMgPSB0aGlzLnJlY29uY2lsZXIudXBkYXRlRmlsZVdpdGhKZXN0U3RhdHVzKGRhdGEpO1xuICAgIHJlc3VsdHM/LmZvckVhY2goKHIpID0+IHtcbiAgICAgIGNvbnN0IHJlY29yZCA9IHRoaXMudGVzdFN1aXRlcy5nZXQoci5maWxlKSA/PyB0aGlzLmFkZFRlc3RTdWl0ZVJlY29yZChyLmZpbGUpO1xuICAgICAgcmVjb3JkLnVwZGF0ZSh7XG4gICAgICAgIHN0YXR1czogci5zdGF0dXMsXG4gICAgICAgIG1lc3NhZ2U6IHIubWVzc2FnZSxcbiAgICAgICAgaXNUZXN0RmlsZTogdHJ1ZSxcbiAgICAgICAgYXNzZXJ0aW9uQ29udGFpbmVyOiB1bmRlZmluZWQsXG4gICAgICAgIHJlc3VsdHM6IHVuZGVmaW5lZCxcbiAgICAgICAgc29ydGVkOiB1bmRlZmluZWQsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICB0aGlzLmV2ZW50cy50ZXN0U3VpdGVDaGFuZ2VkLmZpcmUoe1xuICAgICAgdHlwZTogJ2Fzc2VydGlvbnMtdXBkYXRlZCcsXG4gICAgICBmaWxlczogcmVzdWx0cy5tYXAoKHIpID0+IHIuZmlsZSksXG4gICAgICBwcm9jZXNzLFxuICAgIH0pO1xuICAgIHJldHVybiByZXN1bHRzO1xuICB9XG5cbiAgcmVtb3ZlQ2FjaGVkUmVzdWx0cyhmaWxlUGF0aDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy50ZXN0U3VpdGVzLmRlbGV0ZShmaWxlUGF0aCk7XG4gIH1cbiAgaW52YWxpZGF0ZVRlc3RSZXN1bHRzKGZpbGVQYXRoOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLnJlbW92ZUNhY2hlZFJlc3VsdHMoZmlsZVBhdGgpO1xuICAgIHRoaXMucmVjb25jaWxlci5yZW1vdmVUZXN0RmlsZShmaWxlUGF0aCk7XG4gIH1cblxuICAvLyB0ZXN0IHN0YXRzXG4gIGdldFRlc3RTdWl0ZVN0YXRzKCk6IFRlc3RTdGF0cyB7XG4gICAgY29uc3Qgc3RhdHMgPSBlbXB0eVRlc3RTdGF0cygpO1xuICAgIHRoaXMudGVzdFN1aXRlcy5mb3JFYWNoKChzdWl0ZSkgPT4ge1xuICAgICAgaWYgKHN1aXRlLnN0YXR1cyA9PT0gJ0tub3duU3VjY2VzcycpIHtcbiAgICAgICAgc3RhdHMuc3VjY2VzcyArPSAxO1xuICAgICAgfSBlbHNlIGlmIChzdWl0ZS5zdGF0dXMgPT09ICdLbm93bkZhaWwnKSB7XG4gICAgICAgIHN0YXRzLmZhaWwgKz0gMTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YXRzLnVua25vd24gKz0gMTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmICh0aGlzLnRlc3RGaWxlcykge1xuICAgICAgaWYgKHRoaXMudGVzdEZpbGVzLmxlbmd0aCA+IHN0YXRzLmZhaWwgKyBzdGF0cy5zdWNjZXNzICsgc3RhdHMudW5rbm93bikge1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIC4uLnN0YXRzLFxuICAgICAgICAgIHVua25vd246IHRoaXMudGVzdEZpbGVzLmxlbmd0aCAtIHN0YXRzLmZhaWwgLSBzdGF0cy5zdWNjZXNzLFxuICAgICAgICB9O1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc3RhdHM7XG4gIH1cblxuICAvLyBzbmFwc2hvdCBzdXBwb3J0XG5cbiAgcHVibGljIHByZXZpZXdTbmFwc2hvdCh0ZXN0UGF0aDogc3RyaW5nLCB0ZXN0RnVsbE5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLnNuYXBzaG90UHJvdmlkZXIucHJldmlld1NuYXBzaG90KHRlc3RQYXRoLCB0ZXN0RnVsbE5hbWUpO1xuICB9XG59XG4iXX0=