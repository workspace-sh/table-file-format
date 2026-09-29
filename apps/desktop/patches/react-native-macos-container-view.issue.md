# Draft issue for microsoft/react-native-macos (not filed)

This is a draft for the issue behind `react-native-macos+0.81.7.patch`. It
hasn't been filed: posting to an outside repository is Leslie's decision.
Once upstream fixes it, delete the patch and this file.

---

**Title:** Fabric: mounting a child into a view with `overflow: hidden` and a `boxShadow` crashes with `-[NSView insertSubview:atIndex:]: unrecognized selector`

**Environment**

- react-native-macos 0.81.7 (the same code is on `0.81-stable` and `main`)
- New Architecture (Fabric), macOS 27

**What happens**

Give a view `overflow: "hidden"` and a `boxShadow` (an `outline` does the same),
then mount a new child into it after it has first rendered. The app aborts:

```
*** Terminating app due to uncaught exception 'NSInvalidArgumentException',
reason: '-[NSView insertSubview:atIndex:]: unrecognized selector sent to instance 0x...'
  -[RCTViewComponentView mountChildComponentView:index:]
  RCTPerformMountInstructions(...)
  -[RCTMountingManager performTransaction:]
```

**Minimal repro**

```tsx
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

export default function App() {
  const [more, setMore] = useState(false);
  return (
    <Pressable onPress={() => setMore(true)}>
      <View style={{ overflow: "hidden", boxShadow: "inset 0 0 0 2px #0a84ff", padding: 12 }}>
        <Text>Click me</Text>
        {more && <Text>Mounted after the first render: this crashes</Text>}
      </View>
    </Pressable>
  );
}
```

A click aborts the app. Without the `boxShadow`, or without `overflow: "hidden"`,
it works.

**Cause**

When `styleWouldClipOverflowInk` is true (`overflow: hidden` plus a `boxShadow`
or an outline), `-[RCTViewComponentView currentContainerView]` makes a separate
container for the children:

```objc
_containerView = [[RCTPlatformView alloc] initWithFrame:...]; // [macOS]
```

On macOS `RCTPlatformView` is a plain `NSView`. `mountChildComponentView:index:`
then calls `[self.currentContainerView insertSubview:childComponentView atIndex:index]`,
but `-insertSubview:atIndex:` is defined only on `RCTUIView` (`RCTUIKit.m`), so it
throws. A plain `NSView` also isn't flipped, unlike every other React view.

**Fix**

Create the container as an `RCTUIView`:

```objc
_containerView = [[RCTUIView alloc] initWithFrame:...]; // [macOS]
```

We carry this as a patch-package patch, and cell editing works with it. In our
app the crash came from a selected table cell (`overflow: hidden` plus an inset
`boxShadow` ring) when the cell's editor mounted.
