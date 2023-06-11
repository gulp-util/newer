interface Options {
	dest?: string;
	ext?: string;
	map?: (input: string) => string;
	extra?: string | string[];
	ctime?: boolean;
}

export { Options };
