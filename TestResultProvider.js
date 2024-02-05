"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestResultProvider = exports.TestSuiteRecord = void 0;
var TestReconciliationState_1 = require("./TestReconciliationState");
var TestResult_1 = require("./TestResult");
var match = require("./match-by-context");
var helpers_1 = require("../helpers");
var test_result_events_1 = require("./test-result-events");
var match_node_1 = require("./match-node");
var snapshot_provider_1 = require("./snapshot-provider");
var jest_editor_support_1 = require("jest-editor-support");
var sortByStatus = function (a, b) {
    if (a.status === b.status) {
        return 0;
    }
    return TestResult_1.TestResultStatusInfo[a.status].precedence - TestResult_1.TestResultStatusInfo[b.status].precedence;
};
var TestSuiteRecord = /** @class */ (function () {
    function TestSuiteRecord(testFile, reconciler, parser) {
        this.testFile = testFile;
        this.reconciler = reconciler;
        this.parser = parser;
        this._status = TestReconciliationState_1.TestReconciliationState.Unknown;
        this._message = '';
    }
    Object.defineProperty(TestSuiteRecord.prototype, "status", {
        get: function () {
            return this._status;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestSuiteRecord.prototype, "message", {
        get: function () {
            return this._message;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestSuiteRecord.prototype, "results", {
        get: function () {
            return this._results;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestSuiteRecord.prototype, "sorted", {
        get: function () {
            return this._sorted;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestSuiteRecord.prototype, "isTestFile", {
        get: function () {
            return this._isTestFile;
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestSuiteRecord.prototype, "testBlocks", {
        /**
         * parse test file and create sourceContainer, if needed.
         * @returns TestBlocks | 'failed'
         */
        get: function () {
            var _a, _b;
            if (!this._testBlocks) {
                try {
                    var pResult = this.parser.parseTestFile(this.testFile);
                    if (![pResult.describeBlocks, pResult.itBlocks].find(function (blocks) { return blocks.length > 0; })) {
                        // nothing in this file yet, skip. Otherwise we might accidentally publish a source file, for example
                        return 'failed';
                    }
                    var sourceContainer = match.buildSourceContainer(pResult.root);
                    this._testBlocks = __assign(__assign({}, pResult), { sourceContainer: sourceContainer });
                    var snapshotBlocks = this.parser.parseSnapshot(this.testFile).blocks;
                    if (snapshotBlocks.length > 0) {
                        this.updateSnapshotAttr(sourceContainer, snapshotBlocks);
                    }
                }
                catch (e) {
                    // normal to fail, for example when source file has syntax error
                    if ((_a = this.parser.options) === null || _a === void 0 ? void 0 : _a.verbose) {
                        console.log("parseTestBlocks failed for ".concat(this.testFile), e);
                    }
                    this._testBlocks = 'failed';
                }
            }
            return (_b = this._testBlocks) !== null && _b !== void 0 ? _b : 'failed';
        },
        enumerable: false,
        configurable: true
    });
    Object.defineProperty(TestSuiteRecord.prototype, "assertionContainer", {
        get: function () {
            if (!this._assertionContainer) {
                var assertions = this.reconciler.assertionsForTestFile(this.testFile);
                if (assertions && assertions.length > 0) {
                    this._assertionContainer = match.buildAssertionContainer(assertions);
                }
            }
            return this._assertionContainer;
        },
        enumerable: false,
        configurable: true
    });
    TestSuiteRecord.prototype.updateSnapshotAttr = function (container, snapshots) {
        var _this = this;
        var isWithin = function (snapshot, range) {
            var zeroBasedLine = snapshot.node.loc.start.line - 1;
            return !!range && range.start.line <= zeroBasedLine && range.end.line >= zeroBasedLine;
        };
        if (container.name !== match_node_1.ROOT_NODE_NAME &&
            container.attrs.range &&
            !snapshots.find(function (s) { return isWithin(s, container.attrs.range); })) {
            return;
        }
        container.childData.forEach(function (block) {
            var snapshot = snapshots.find(function (s) { return isWithin(s, block.attrs.range); });
            if (snapshot) {
                block.attrs.snapshot = snapshot.isInline ? 'inline' : 'external';
            }
        });
        container.childContainers.forEach(function (childContainer) {
            return _this.updateSnapshotAttr(childContainer, snapshots);
        });
    };
    TestSuiteRecord.prototype.update = function (change) {
        var _a, _b;
        this._status = (_a = change.status) !== null && _a !== void 0 ? _a : this.status;
        this._message = (_b = change.message) !== null && _b !== void 0 ? _b : this.message;
        this._isTestFile = 'isTestFile' in change ? change.isTestFile : this._isTestFile;
        this._results = 'results' in change ? change.results : this._results;
        this._sorted = 'sorted' in change ? change.sorted : this._sorted;
        this._assertionContainer =
            'assertionContainer' in change ? change.assertionContainer : this._assertionContainer;
    };
    return TestSuiteRecord;
}());
exports.TestSuiteRecord = TestSuiteRecord;
var Parser = /** @class */ (function () {
    function Parser(snapshotProvider, options) {
        this.snapshotProvider = snapshotProvider;
        this.options = options;
    }
    Parser.prototype.parseSnapshot = function (testPath) {
        var res = this.snapshotProvider.parse(testPath, this.options);
        return res;
    };
    Parser.prototype.parseTestFile = function (testPath) {
        var _a;
        var res = (0, jest_editor_support_1.parse)(testPath, undefined, (_a = this.options) === null || _a === void 0 ? void 0 : _a.parserOptions);
        return res;
    };
    return Parser;
}());
var TestResultProvider = /** @class */ (function () {
    function TestResultProvider(extEvents, options) {
        if (options === void 0) { options = { verbose: false }; }
        this.reconciler = new jest_editor_support_1.TestReconciler();
        this._options = options;
        this.events = (0, test_result_events_1.createTestResultEvents)();
        this.testSuites = new Map();
        this.snapshotProvider = new snapshot_provider_1.SnapshotProvider();
        this.parser = new Parser(this.snapshotProvider, this._options);
        extEvents.onTestSessionStarted.event(this.onSessionStart.bind(this));
    }
    TestResultProvider.prototype.dispose = function () {
        this.events.testListUpdated.dispose();
        this.events.testSuiteChanged.dispose();
    };
    Object.defineProperty(TestResultProvider.prototype, "options", {
        set: function (options) {
            this._options = options;
            this.parser.options = this._options;
            this.testSuites.clear();
        },
        enumerable: false,
        configurable: true
    });
    TestResultProvider.prototype.addTestSuiteRecord = function (testFile) {
        var record = new TestSuiteRecord(testFile, this.reconciler, this.parser);
        this.testSuites.set(testFile, record);
        return record;
    };
    TestResultProvider.prototype.onSessionStart = function () {
        this.testSuites.clear();
        this.reconciler = new jest_editor_support_1.TestReconciler();
    };
    TestResultProvider.prototype.groupByRange = function (results) {
        if (!results.length) {
            return results;
        }
        // build a range based map
        var byRange = new Map();
        results.forEach(function (r) {
            // Q: is there a better/efficient way to index the range?
            var key = "".concat(r.start.line, "-").concat(r.start.column, "-").concat(r.end.line, "-").concat(r.end.column);
            var list = byRange.get(key);
            if (!list) {
                byRange.set(key, [r]);
            }
            else {
                list.push(r);
            }
        });
        // sort the test by status precedence
        byRange.forEach(function (list) { return list.sort(sortByStatus); });
        //merge multiResults under the primary (highest precedence)
        var consolidated = [];
        byRange.forEach(function (list) {
            if (list.length > 1) {
                list[0].multiResults = list.slice(1);
            }
            consolidated.push(list[0]);
        });
        return consolidated;
    };
    TestResultProvider.prototype.updateTestFileList = function (testFiles) {
        this.testFiles = testFiles;
        // clear the cache in case we have cached some non-test files prior
        this.testSuites.clear();
        this.events.testListUpdated.fire(testFiles);
    };
    TestResultProvider.prototype.getTestList = function () {
        var _this = this;
        if (this.testFiles && this.testFiles.length > 0) {
            return this.testFiles;
        }
        return Array.from(this.testSuites.keys()).filter(function (f) { return _this.isTestFile(f); });
    };
    TestResultProvider.prototype.isTestFile = function (fileName) {
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
        var _record = (_c = this.testSuites.get(fileName)) !== null && _c !== void 0 ? _c : this.addTestSuiteRecord(fileName);
        if (_record.isTestFile === false) {
            return false;
        }
        console.error('4');
        // check if the file is a test file by parsing the content
        var isTestFile = _record.testBlocks !== 'failed';
        _record.update({ isTestFile: isTestFile });
        console.error('5');
        return isTestFile;
    };
    TestResultProvider.prototype.getTestSuiteResult = function (filePath) {
        return this.testSuites.get(filePath);
    };
    /**
     * match assertions with source file, if successful, update cache, results and related.
     * Will also fire testSuiteChanged event
     *
     * if the file is not a test or can not be parsed, the results will be undefined.
     * any other errors will result the source blocks to be returned as unmatched block.
     **/
    TestResultProvider.prototype.updateMatchedResults = function (filePath, record) {
        var error;
        var status = record.status;
        // make sure we do not fire changeEvent since that will be proceeded with match or unmatched event anyway
        var testBlocks = record.testBlocks;
        if (testBlocks === 'failed') {
            record.update({ status: 'KnownFail', message: 'test file parse error', results: [] });
            return;
        }
        var itBlocks = testBlocks.itBlocks;
        if (record.assertionContainer) {
            try {
                var results = this.groupByRange(match.matchTestAssertions(filePath, testBlocks.sourceContainer, record.assertionContainer, this._options.verbose));
                record.update({ results: results });
                this.events.testSuiteChanged.fire({
                    type: 'result-matched',
                    file: filePath,
                });
                return;
            }
            catch (e) {
                console.warn("failed to match test results for ".concat(filePath, ":"), e);
                error = "encountered internal match error: ".concat(e);
                status = 'KnownFail';
            }
        }
        else {
            // there might be many reasons for this, for example the test is not yet run, so leave it as unknown
            error = 'no assertion generated for file';
        }
        // no need to do groupByRange as the source block will not have blocks under the same location
        record.update({
            status: status,
            message: error,
            results: itBlocks.map(function (t) { return match.toMatchResult(t, 'no assertion found', 'match-failed'); }),
        });
        // file match failed event so the listeners can display the source blocks instead
        this.events.testSuiteChanged.fire({
            type: 'result-match-failed',
            file: filePath,
            sourceContainer: testBlocks.sourceContainer,
        });
    };
    /**
     * returns matched test results for the given file
     * @param filePath
     * @returns valid test result list or an empty array if the source file is not a test or can not be parsed.
     */
    TestResultProvider.prototype.getResults = function (filePath, record) {
        var _a;
        if (!this.isTestFile(filePath)) {
            return;
        }
        var _record = (_a = record !== null && record !== void 0 ? record : this.testSuites.get(filePath)) !== null && _a !== void 0 ? _a : this.addTestSuiteRecord(filePath);
        if (_record.results) {
            return _record.results;
        }
        this.updateMatchedResults(filePath, _record);
        return _record.results;
    };
    /**
     * returns sorted test results for the given file
     * @param filePath
     * @returns valid sorted test result or undefined if the file is not a test.
     */
    TestResultProvider.prototype.getSortedResults = function (filePath) {
        var _a;
        if (!this.isTestFile(filePath)) {
            return;
        }
        var record = (_a = this.testSuites.get(filePath)) !== null && _a !== void 0 ? _a : this.addTestSuiteRecord(filePath);
        if (record.sorted) {
            return record.sorted;
        }
        var sorted = {
            fail: [],
            skip: [],
            success: [],
            unknown: [],
        };
        var testResults = this.getResults(filePath, record);
        if (!testResults) {
            return;
        }
        for (var _i = 0, testResults_1 = testResults; _i < testResults_1.length; _i++) {
            var test_1 = testResults_1[_i];
            if (test_1.status === TestReconciliationState_1.TestReconciliationState.KnownFail) {
                sorted.fail.push(test_1);
            }
            else if (test_1.status === TestReconciliationState_1.TestReconciliationState.KnownSkip) {
                sorted.skip.push(test_1);
            }
            else if (test_1.status === TestReconciliationState_1.TestReconciliationState.KnownSuccess) {
                sorted.success.push(test_1);
            }
            else {
                sorted.unknown.push(test_1);
            }
        }
        record.update({ sorted: sorted });
        return sorted;
    };
    TestResultProvider.prototype.updateTestResults = function (data, process) {
        var _this = this;
        var results = this.reconciler.updateFileWithJestStatus(data);
        results === null || results === void 0 ? void 0 : results.forEach(function (r) {
            var _a;
            var record = (_a = _this.testSuites.get(r.file)) !== null && _a !== void 0 ? _a : _this.addTestSuiteRecord(r.file);
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
            files: results.map(function (r) { return r.file; }),
            process: process,
        });
        return results;
    };
    TestResultProvider.prototype.removeCachedResults = function (filePath) {
        this.testSuites.delete(filePath);
    };
    TestResultProvider.prototype.invalidateTestResults = function (filePath) {
        this.removeCachedResults(filePath);
        this.reconciler.removeTestFile(filePath);
    };
    // test stats
    TestResultProvider.prototype.getTestSuiteStats = function () {
        var stats = (0, helpers_1.emptyTestStats)();
        this.testSuites.forEach(function (suite) {
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
                return __assign(__assign({}, stats), { unknown: this.testFiles.length - stats.fail - stats.success });
            }
        }
        return stats;
    };
    // snapshot support
    TestResultProvider.prototype.previewSnapshot = function (testPath, testFullName) {
        return this.snapshotProvider.previewSnapshot(testPath, testFullName);
    };
    return TestResultProvider;
}());
exports.TestResultProvider = TestResultProvider;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiVGVzdFJlc3VsdFByb3ZpZGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiVGVzdFJlc3VsdFByb3ZpZGVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7O0FBQUEscUVBQWlHO0FBQ2pHLDJDQUFnRTtBQUNoRSwwQ0FBNEM7QUFHNUMsc0NBQTRDO0FBQzVDLDJEQUFnRjtBQUNoRiwyQ0FBNkQ7QUFFN0QseURBQXdGO0FBQ3hGLDJEQVU2QjtBQTJCN0IsSUFBTSxZQUFZLEdBQUcsVUFBQyxDQUFhLEVBQUUsQ0FBYTtJQUNoRCxJQUFJLENBQUMsQ0FBQyxNQUFNLEtBQUssQ0FBQyxDQUFDLE1BQU0sRUFBRTtRQUN6QixPQUFPLENBQUMsQ0FBQztLQUNWO0lBQ0QsT0FBTyxpQ0FBb0IsQ0FBQyxDQUFDLENBQUMsTUFBTSxDQUFDLENBQUMsVUFBVSxHQUFHLGlDQUFvQixDQUFDLENBQUMsQ0FBQyxNQUFNLENBQUMsQ0FBQyxVQUFVLENBQUM7QUFDL0YsQ0FBQyxDQUFDO0FBRUY7SUFVRSx5QkFDUyxRQUFnQixFQUNmLFVBQTBCLEVBQzFCLE1BQWM7UUFGZixhQUFRLEdBQVIsUUFBUSxDQUFRO1FBQ2YsZUFBVSxHQUFWLFVBQVUsQ0FBZ0I7UUFDMUIsV0FBTSxHQUFOLE1BQU0sQ0FBUTtRQUV0QixJQUFJLENBQUMsT0FBTyxHQUFHLGlEQUF1QixDQUFDLE9BQU8sQ0FBQztRQUMvQyxJQUFJLENBQUMsUUFBUSxHQUFHLEVBQUUsQ0FBQztJQUNyQixDQUFDO0lBQ0Qsc0JBQVcsbUNBQU07YUFBakI7WUFDRSxPQUFPLElBQUksQ0FBQyxPQUFPLENBQUM7UUFDdEIsQ0FBQzs7O09BQUE7SUFDRCxzQkFBVyxvQ0FBTzthQUFsQjtZQUNFLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQztRQUN2QixDQUFDOzs7T0FBQTtJQUNELHNCQUFXLG9DQUFPO2FBQWxCO1lBQ0UsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDO1FBQ3ZCLENBQUM7OztP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