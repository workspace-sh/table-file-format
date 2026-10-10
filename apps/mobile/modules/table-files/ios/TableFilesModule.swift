// Replacing a file in one step. Core's writer saves a file by staging it
// beside its target and renaming it over (TableFs.rename): a reader, or
// the app started again after being ended mid-save, sees the old file or
// the new one, never neither. The platform's file manager won't move a
// file onto one that exists, and removing the target first leaves a
// moment with no file at all; rename(2) has no such moment.

import ExpoModulesCore
import Foundation

public class TableFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TableFiles")

    /// Move the file at `from` to `to` (file-system paths, not URLs), replacing what is there.
    Function("rename") { (from: String, to: String) in
      if Darwin.rename(from, to) != 0 {
        throw Exception(name: "ERR_TABLE_FILES_RENAME", description: String(cString: strerror(errno)))
      }
    }
  }
}
