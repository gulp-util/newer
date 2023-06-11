import { Transform } from "stream";
import fs from "fs";
import path from "path";
import glob from "glob";

import Q from "kew";
import PluginError from "plugin-error";

import type File from "vinyl";
import type { TransformCallback } from "stream";
import type { Options } from "./types";

const PLUGIN_NAME = "gulp-newer";

class Newer extends Transform {
	/**
	 * Path to destination directory or file.
	 */
	_dest: string;

	/**
	 * Optional extension for destination files.
	 */
	_ext: string;

	/**
	 * Optional function for mapping relative source files to destination files.
	 */
	_map: (input: string) => string;

	/**
	 * Key for the timestamp in files' stats object
	 */
	_timestamp: "ctime" | "mtime";

	/**
	 * Promise for the dest file/directory stats.
	 */
	_destStats: fs.Stats;

	/**
	 * If the provided dest is a file, we want to pass through all files if any
	 * one of the source files is newer than the dest.  To support this, source
	 * files need to be buffered until a newer file is found.  When a newer file
	 * is found, buffered source files are flushed (and the `_all` flag is set).
	 */
	_bufferedFiles: File[] = null;

	/**
	 * Indicates that all files should be passed through.  This is set when the
	 * provided dest is a file and we have already encountered a newer source
	 * file.  When true, all remaining source files should be passed through.
	 */
	_all = false;

	/**
	 * Indicates that there are extra files (configuration files, etc.)
	 * that are not to be fed into the stream, but that should force
	 * all files to be rebuilt if *any* are older than one of the extra
	 * files.
	 */
	_extraStats: fs.Stats = null;

	constructor(options: Options) {
		super();
		Transform.call(this, { objectMode: true });

		if (!options) {
			throw new PluginError(
				PLUGIN_NAME,
				"Requires a dest string or options object"
			);
		}

		if (options.dest && typeof options.dest !== "string") {
			throw new PluginError(PLUGIN_NAME, "Requires a dest string");
		}

		if (options.ext && typeof options.ext !== "string") {
			throw new PluginError(PLUGIN_NAME, "Requires ext to be a string");
		}

		if (options.map && typeof options.map !== "function") {
			throw new PluginError(PLUGIN_NAME, "Requires map to be a function");
		}

		if (!options.dest && !options.map) {
			throw new PluginError(
				PLUGIN_NAME,
				"Requires either options.dest or options.map or both"
			);
		}

		if (options.extra) {
			if (typeof options.extra === "string") {
				options.extra = [options.extra];
			} else if (!Array.isArray(options.extra)) {
				throw new PluginError(
					PLUGIN_NAME,
					"Requires options.extra to be a string or array"
				);
			}
		}

		this._dest = options.dest;

		this._ext = options.ext;

		this._map = options.map;

		this._timestamp = options.ctime ? "ctime" : "mtime";

		this._destStats = this._dest
			? Q.nfcall(fs.stat, this._dest)
			: Q.resolve(null);

		if (options.extra) {
			const extraFiles = [];
			const timestamp = this._timestamp;
			for (let i = 0; i < options.extra.length; ++i) {
				extraFiles.push(Q.nfcall(glob, options.extra[i]));
			}
			this._extraStats = Q.all(extraFiles)
				.then(function (fileArrays: string[][]) {
					// First collect all the files in all the glob result arrays
					let allFiles = <string[]>[];
					let i;
					for (i = 0; i < fileArrays.length; ++i) {
						allFiles = allFiles.concat(fileArrays[i]);
					}
					const extraStats = [];
					for (i = 0; i < allFiles.length; ++i) {
						extraStats.push(Q.nfcall(fs.stat, allFiles[i]));
					}
					return Q.all(extraStats);
				})
				.then(function (resolvedStats: fs.Stats[]) {
					// We get all the file stats here; find the *latest* modification.
					let latestStat = resolvedStats[0];
					for (let j = 1; j < resolvedStats.length; ++j) {
						if (
							resolvedStats[j][timestamp] > latestStat[timestamp]
						) {
							latestStat = resolvedStats[j];
						}
					}
					return latestStat;
				})
				.fail(function (error: NodeJS.ErrnoException) {
					if (error && error.path) {
						throw new PluginError(
							PLUGIN_NAME,
							"Failed to read stats for an extra file: " +
								error.path
						);
					} else {
						throw new PluginError(
							PLUGIN_NAME,
							"Failed to stat extra files; unknown error: " +
								error
						);
					}
				});
		}
	}
	/**
	 * Pass through newer files only.
	 * @param {File} srcFile A vinyl file.
	 * @param {string} encoding Encoding (ignored).
	 * @param {function(Error, File)} done Callback.
	 */
	_transform(srcFile: File, encoding: string, done: TransformCallback) {
		if (!srcFile || !srcFile.stat) {
			done(
				new PluginError(
					PLUGIN_NAME,
					"Expected a source file with stats"
				)
			);
			return;
		}
		const self = this;
		Q.resolve([this._destStats, this._extraStats])
			.spread(function (destStats: fs.Stats, extraStats: fs.Stats) {
				if (
					(destStats && destStats.isDirectory()) ||
					self._ext ||
					self._map
				) {
					// stat dest/relative file
					const relative = srcFile.relative;
					const ext = path.extname(relative);
					let destFileRelative = self._ext
						? relative.substr(0, relative.length - ext.length) +
						  self._ext
						: relative;
					if (self._map) {
						destFileRelative = self._map(destFileRelative);
					}
					const destFileJoined = self._dest
						? path.join(self._dest, destFileRelative)
						: destFileRelative;
					return Q.all([
						Q.nfcall(fs.stat, destFileJoined),
						extraStats,
					]);
				} else {
					// wait to see if any are newer, then pass through all
					if (!self._bufferedFiles) {
						self._bufferedFiles = [];
					}
					return [destStats, extraStats];
				}
			})
			.fail(function (err: NodeJS.ErrnoException) {
				if (err.code === "ENOENT") {
					// dest file or directory doesn't exist, pass through all
					return Q.resolve([null, this._extraStats]);
				} else {
					// unexpected error
					return Q.reject(err);
				}
			})
			.spread(function (
				destFileStats: fs.Stats,
				extraFileStats: fs.Stats
			) {
				const timestamp = self._timestamp;
				let newer =
					!destFileStats ||
					srcFile.stat[timestamp] > destFileStats[timestamp];
				// If *any* extra file is newer than a destination file, then ALL
				// are newer.
				if (
					extraFileStats &&
					extraFileStats[timestamp] > destFileStats[timestamp]
				) {
					newer = true;
				}
				if (self._all) {
					self.push(srcFile);
				} else if (!newer) {
					if (self._bufferedFiles) {
						self._bufferedFiles.push(srcFile);
					}
				} else {
					if (self._bufferedFiles) {
						// flush buffer
						self._bufferedFiles.forEach(function (file) {
							self.push(file);
						});
						self._bufferedFiles.length = 0;
						// pass through all remaining files as well
						self._all = true;
					}
					self.push(srcFile);
				}
				done();
			})
			.fail(done)
			.end();
	}

	/**
	 * Remove references to buffered files.
	 */
	_flush(done: TransformCallback) {
		this._bufferedFiles = null;
		done();
	}
}

/**
 * Only pass through source files that are newer than the provided destination.
 */
export = function (options: Options | string) {
	if (typeof options === "string") {
		return new Newer({ dest: options });
	}
	return new Newer(options);
};
