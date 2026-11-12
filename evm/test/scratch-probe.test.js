// DELETE ME. Leftover scaffolding from the 2026-09-19 run, which was interrupted before it
// could clean up after itself. The file used to hold a throwaway probe that demonstrated the
// collateral position double-listing bug; that finding is now covered properly by the
// "a position emptied and refunded is listed once, not twice" tests in relicpay.test.js and
// enhanced.test.js, so the probe has no reason to exist.
//
// The 2026-09-20 run could not delete it: file deletion inside the connected folder needs an
// interactive approval, and a scheduled run has nobody to grant one. Emptying it to a comment
// was the next best thing, since mocha still loads test/**/*.test.js but this contributes
// zero tests. Safe to `rm` by hand at any time.
