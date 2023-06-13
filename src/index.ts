import { Transform } from "stream";
import fs from "fs";
import path from "path";
import glob from "glob";

import PluginError from "plugin-error";

import type File from "vinyl";
import type { TransformCallback } from "stream";
import type { Options } from "./types";

const PLUGIN_NAME = "gulp-newer";

function replaceExtension(file: string, ext: string) {
	if (!ext) {
		return file;
	}
	const original = path.extname(file);
	const noExt = file.substring(0, file.length - original.length);
	return noExt + ext;
}

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
		super({ objectMode: true });

		this._checkOptions(options);

		this._dest = options.dest;

		this._ext = options.ext;

		this._map = options.map;

		this._timestamp = options.ctime ? "ctime" : "mtime";

		this._destStats = this._dest
			? fs.statSync(this._dest, { throwIfNoEntry: false })
			: null;

		if (options.extra) {
			this._getExtraStats(options);
		}
	}

	_getExtraStats(options: Options) {
		const extraFiles = [];
		const timestamp = this._timestamp;
		for (let i = 0; i < options.extra.length; ++i) {
			extraFiles.push(glob.sync(options.extra[i]));
		}

		let allFiles = <string[]>[];
		let i;
		for (i = 0; i < extraFiles.length; ++i) {
			allFiles = allFiles.concat(extraFiles[i]);
		}
		const extraStats = [];
		for (i = 0; i < allFiles.length; ++i) {
			try {
				extraStats.push(fs.statSync(allFiles[i]));
			} catch (error) {
				if (error && error.path) {
					throw new PluginError(
						PLUGIN_NAME,
						"Failed to read stats for an extra file: " + error.path
					);
				}
				throw new PluginError(
					PLUGIN_NAME,
					"Failed to stat extra files; unknown error: " + error
				);
			}
		}
		let latestStat = extraStats[0];
		for (let j = 1; j < extraStats.length; ++j) {
			if (extraStats[j][timestamp] > latestStat[timestamp]) {
				latestStat = extraStats[j];
			}
		}

		this._extraStats = latestStat;
	}

	_checkOptions(options: Options) {
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
	}

	_isNewer(dest: fs.Stats, src: fs.Stats) {
		const ts = this._timestamp;
		if (this._extraStats && this._extraStats[ts] > dest[ts]) {
			return true;
		}
		if (!dest) {
			return true;
		}
		return src[ts] > dest[ts];
	}

	_bufferPush(srcFile: File, newer: boolean) {
		if (this._all) {
			this.push(srcFile);
			return;
		}
		if (!newer) {
			this._bufferedFiles?.push(srcFile);
			return;
		}
		if (!this._bufferedFiles) {
			this.push(srcFile);
			return;
		}

		// flush buffer
		for (const file of this._bufferedFiles) {
			this.push(file);
		}
		this._bufferedFiles.length = 0;
		// pass through all remaining files as well
		this._all = true;
		this.push(srcFile);
	}

	_specialStat(srcFile: File) {
		// stat dest/relative file
		const relative = srcFile.relative;
		let destFileRelative = replaceExtension(relative, this._ext);
		if (this._map) {
			destFileRelative = this._map(destFileRelative);
		}
		const destFileJoined = this._dest
			? path.join(this._dest, destFileRelative)
			: destFileRelative;
		try {
			return fs.statSync(destFileJoined);
		} catch (err) {
			if (err.code !== "ENOENT") {
				// unexpected error
				throw err;
			}
			// dest file or directory doesn't exist, pass through all
			return null;
		}
	}

	_getDestStats(srcFile: File) {
		const destDirectory = this._destStats && this._destStats.isDirectory();
		if (destDirectory || this._ext || this._map) {
			return this._specialStat(srcFile);
		}
		// wait to see if any are newer, then pass through all
		if (!this._bufferedFiles) {
			this._bufferedFiles = [];
		}

		return this._destStats;
	}

	push(chunk: any, encoding?: BufferEncoding): boolean {
		try {
			return super.push(chunk, encoding);
		} catch (err) {
			this.emit("error", err);
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

		const destStats = this._getDestStats(srcFile);

		const newer = this._isNewer(destStats, srcFile.stat);

		this._bufferPush(srcFile, newer);

		done();
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
