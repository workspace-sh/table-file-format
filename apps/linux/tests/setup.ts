import { configure } from "@gtkx/testing";

// Saving waits 400 ms after the last edit, then writes; with a dialog up,
// the first write can take longer than the 1 s default. Waiting on the
// file is how these tests see a save, so they wait up to 5 s.
configure({ asyncUtilTimeout: 5000 });
