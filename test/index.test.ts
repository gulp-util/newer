import { Transform } from "stream";
import fs from "fs";
import path from "path";

import expect from "expect";
import Vinyl from "vinyl";
import mock from "mock-fs";

import newer from "..";

/**
 * Test utility function.  Create File instances for each of the provided paths
 * and write to the provided stream.  Call stream.end() when done.
 */
function write(stream: Transform, paths: string[]) {
	paths.forEach(function (filePath) {
		stream.write(
			new Vinyl({
				contents: fs.readFileSync(filePath),
				path: path.resolve(filePath),
				stat: fs.statSync(filePath),
			})
		);
	});
	stream.end();
}

describe("newer()", function () {
	it("creates a transform stream", function () {
		const stream = newer("foo");
		expect(stream).toBeInstanceOf(Transform);
	});

	it("requires a string dest or an object with the dest property", function () {
		// @ts-expect-error Test if arguments missing
		expect(() => newer()).toThrow();

		// @ts-expect-error Test if argument is wrong type
		expect(() => newer(123)).toThrow();

		expect(() => newer({})).toThrow();
	});

	describe("config.ext", function () {
		it("must be a string", function () {
			// @ts-expect-error Test if ext is wrong type
			expect(() => newer({ dest: "foo", ext: 1 })).toThrow();

			// @ts-expect-error Test if ext is wrong type
			expect(() => newer({ dest: "foo", ext: {} })).toThrow();
		});
	});

	describe("config.map", function () {
		it("must be a function", function () {
			// @ts-expect-error Test if map is wrong type
			expect(() => newer({ dest: "foo", map: 1 })).toThrow();

			// @ts-expect-error Test if map is wrong type
			expect(() => newer({ dest: "foo", map: "bar" })).toThrow();
		});

		it("makes the dest config optional", function () {
			expect(() => newer({ map: (str) => str })).not.toThrow();
		});
	});

	describe("config.extra", function () {
		beforeEach(function () {
			mock({
				main: mock.file({
					content: "main content",
					mtime: new Date(1),
				}),
				imported: mock.file({
					content: "2: other content, used by main",
					mtime: new Date(3),
				}),
				collected: mock.file({
					content: "main content\n1: other content, used by main",
					mtime: new Date(2),
				}),
			});
		});
		afterEach(mock.restore);

		it("must be a string or an array", function () {
			// @ts-expect-error Test if extra is wrong type
			expect(() => newer({ dest: "foo", extra: 1 })).toThrow();

			expect(() =>
				// @ts-expect-error Test if extra is wrong type
				newer({ dest: "foo", extra: function () {} })
			).toThrow();

			expect(() => newer({ dest: "foo", extra: "extra1" })).not.toThrow();

			expect(() =>
				newer({ dest: "foo", extra: ["extra1", "extra2"] })
			).not.toThrow();
		});

		it("must not be passed into stream", function (done) {
			const stream = newer({ dest: "collected", extra: "imported" });

			const paths = ["main"];

			stream.on("data", function (file) {
				expect(file.path).not.toEqual(path.resolve("imported"));
			});
			stream.on("error", done);
			stream.on("end", done);

			write(stream, paths);
		});

		it('must let other files through stream if an "extra" is newer', function (done) {
			const stream = newer({ dest: "collected", extra: "imported" });

			const paths = ["main"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest dir that does not exist", function () {
		beforeEach(function () {
			mock({
				source1: "source1 content",
				source2: "source2 content",
				source3: "source3 content",
			});
		});
		afterEach(mock.restore);

		it("passes through all files", function (done) {
			const stream = newer("new/dir");

			const paths = ["source1", "source2", "source3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest file that does not exist", function () {
		beforeEach(function () {
			mock({
				file1: "file1 content",
				file2: "file2 content",
				file3: "file3 content",
				dest: {},
			});
		});
		afterEach(mock.restore);

		it("passes through all files", function (done) {
			const stream = newer("dest/concat");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("empty dest dir", function () {
		beforeEach(function () {
			mock({
				source1: "source1 content",
				source2: "source2 content",
				source3: "source3 content",
				dest: {},
			});
		});
		afterEach(mock.restore);

		it("passes through all files", function (done) {
			const stream = newer("dest");

			const paths = ["source1", "source2", "source3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest dir with one older file", function () {
		beforeEach(function () {
			mock({
				file1: "file1 content",
				file2: "file2 content",
				file3: "file3 content",
				dest: {
					file2: mock.file({
						content: "file2 content",
						mtime: new Date(1),
						ctime: new Date(1),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through all files", function (done) {
			const stream = newer("dest");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});

		it("passes through all files, checking ctime", function (done) {
			const stream = newer({ dest: "dest", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest dir with one newer file", function () {
		beforeEach(function () {
			mock({
				file1: mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file2: mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file3: mock.file({
					content: "file3 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					file2: mock.file({
						content: "file2 content",
						mtime: new Date(200),
						ctime: new Date(200),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through two newer files", function (done) {
			const stream = newer("dest");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).not.toEqual(path.resolve("file2"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length - 1);
				done();
			});

			write(stream, paths);
		});

		it("passes through two newer files, checking ctime", function (done) {
			const stream = newer({ dest: "dest", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).not.toEqual(path.resolve("file2"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length - 1);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest dir with two newer and one older file", function () {
		beforeEach(function () {
			mock({
				file1: mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file2: mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file3: mock.file({
					content: "file3 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					file1: mock.file({
						content: "file1 content",
						mtime: new Date(150),
						ctime: new Date(150),
					}),
					file2: mock.file({
						content: "file2 content",
						mtime: new Date(50),
						ctime: new Date(50),
					}),
					file3: mock.file({
						content: "file3 content",
						mtime: new Date(150),
						ctime: new Date(150),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through one newer file", function (done) {
			const stream = newer("dest");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});

		it("passes through one newer file, checking ctime", function (done) {
			const stream = newer({ dest: "dest", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest file with first source file newer", function () {
		beforeEach(function () {
			mock({
				file1: mock.file({
					content: "file1 content",
					mtime: new Date(200),
					ctime: new Date(200),
				}),
				file2: mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file3: mock.file({
					content: "file3 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					output: mock.file({
						content: "file2 content",
						mtime: new Date(150),
						ctime: new Date(150),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through all source files", function (done) {
			const stream = newer("dest/output");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});

		it("passes through all source files, checking ctime", function (done) {
			const stream = newer({ dest: "dest/output", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest file with second source file newer", function () {
		beforeEach(function () {
			mock({
				file1: mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file2: mock.file({
					content: "file2 content",
					mtime: new Date(200),
					ctime: new Date(200),
				}),
				file3: mock.file({
					content: "file3 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					output: mock.file({
						content: "file2 content",
						mtime: new Date(150),
						ctime: new Date(150),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through all source files", function (done) {
			const stream = newer("dest/output");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});

		it("passes through all source files, checking ctime", function (done) {
			const stream = newer({ dest: "dest/output", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest file with last source file newer", function () {
		beforeEach(function () {
			mock({
				file1: mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file2: mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file3: mock.file({
					content: "file3 content",
					mtime: new Date(200),
					ctime: new Date(200),
				}),
				dest: {
					output: mock.file({
						content: "file2 content",
						mtime: new Date(150),
						ctime: new Date(150),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through all source files", function (done) {
			const stream = newer("dest/output");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});

		it("passes through all source files, checking ctime", function (done) {
			const stream = newer({ dest: "dest/output", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve(paths[calls]));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(paths.length);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest file with no newer source files", function () {
		beforeEach(function () {
			mock({
				file1: mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file2: mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				file3: mock.file({
					content: "file3 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					output: mock.file({
						content: "file2 content",
						mtime: new Date(150),
						ctime: new Date(150),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through no source files", function (done) {
			const stream = newer("dest/output");

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function () {
				done(new Error("Expected no source files"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(0);
				done();
			});

			write(stream, paths);
		});

		it("passes through no source files, checking ctime", function (done) {
			const stream = newer({ dest: "dest/output", ctime: true });

			const paths = ["file1", "file2", "file3"];

			let calls = 0;
			stream.on("data", function () {
				done(new Error("Expected no source files"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(0);
				done();
			});

			write(stream, paths);
		});
	});

	describe("dest file ext and two files", function () {
		beforeEach(function () {
			mock({
				"file1.ext1": mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				"file2.ext1": mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					"file1.ext2": mock.file({
						content: "file1 content",
						mtime: new Date(100),
						ctime: new Date(100),
					}),
					"file2.ext2": mock.file({
						content: "file2 content",
						mtime: new Date(50),
						ctime: new Date(50),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through one newer file", function (done) {
			const stream = newer({ dest: "dest", ext: ".ext2" });

			const paths = ["file1.ext1", "file2.ext1"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2.ext1"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});

		it("passes through one newer file, checking ctime", function (done) {
			const stream = newer({ dest: "dest", ext: ".ext2", ctime: true });

			const paths = ["file1.ext1", "file2.ext1"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2.ext1"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});
	});

	describe("custom mapping between source and dest", function () {
		beforeEach(function () {
			mock({
				"file1.ext1": mock.file({
					content: "file1 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				"file2.ext1": mock.file({
					content: "file2 content",
					mtime: new Date(100),
					ctime: new Date(100),
				}),
				dest: {
					"file1.ext2": mock.file({
						content: "file1 content",
						mtime: new Date(100),
						ctime: new Date(100),
					}),
					"file2.ext2": mock.file({
						content: "file2 content",
						mtime: new Date(50),
						ctime: new Date(50),
					}),
				},
			});
		});
		afterEach(mock.restore);

		it("passes through one newer file", function (done) {
			const stream = newer({
				dest: "dest",
				map: function (destPath) {
					return destPath.replace(".ext1", ".ext2");
				},
			});

			const paths = ["file1.ext1", "file2.ext1"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2.ext1"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});

		it("passes through one newer file, checking ctime", function (done) {
			const stream = newer({
				dest: "dest",
				map: function (destPath) {
					return destPath.replace(".ext1", ".ext2");
				},
				ctime: true,
			});

			const paths = ["file1.ext1", "file2.ext1"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2.ext1"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});

		it("allows people to join to dest themselves", function (done) {
			const stream = newer({
				map: function (destPath) {
					return path.join(
						"dest",
						destPath.replace(".ext1", ".ext2")
					);
				},
			});

			const paths = ["file1.ext1", "file2.ext1"];

			let calls = 0;
			stream.on("data", function (file) {
				expect(file.path).toEqual(path.resolve("file2.ext1"));
				++calls;
			});

			stream.on("error", done);

			stream.on("end", function () {
				expect(calls).toEqual(1);
				done();
			});

			write(stream, paths);
		});
	});

	describe("reports errors", function () {
		beforeEach(function () {
			mock({
				q: mock.file({
					mtime: new Date(100),
				}),
				dest: {},
			});
		});
		afterEach(mock.restore);

		it('in "data" handlers', function (done) {
			const stream = newer("dest");

			const err = new Error("test");

			stream.on("data", function () {
				throw err;
			});

			stream.on("error", function (caught) {
				expect(caught).toEqual(err);
				done();
			});

			write(stream, ["q"]);
		});
	});
});
