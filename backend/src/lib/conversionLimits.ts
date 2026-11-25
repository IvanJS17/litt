// The limits every conversion shares, apart from the converter itself so a
// caller can read a limit without loading (or, in a test, replacing) it.

/** Largest source a conversion reads, wherever the conversion is asked for. */
export const CONVERSION_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
/** The answer code for a source above that bound. */
export const CONVERSION_SOURCE_TOO_LARGE_CODE = "convert_source_too_large";

/** Conversions one thread runs at once, and how many more wait their turn. */
export const MAX_CONCURRENT_CONVERSIONS = 2;
export const MAX_QUEUED_CONVERSIONS = 8;
/** Conversions one thread holds at a time, running or waiting. */
export const CONVERSION_PLACES = MAX_CONCURRENT_CONVERSIONS + MAX_QUEUED_CONVERSIONS;
