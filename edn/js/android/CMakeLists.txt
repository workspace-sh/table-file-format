# The core in the Android apps: the C binding (edn/crates/ffi), built per ABI
# into src/main/jniLibs by build-android.sh, put on the JavaScript runtime
# by src/main/cpp/WorkspaceEdn.cpp, as apple/WorkspaceEdn.mm does on Apple.
cmake_minimum_required(VERSION 3.13)
project(workspace_edn)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# React Native's headers and libraries from its AAR, through prefab.
find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)

add_library(workspace_edn SHARED ${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/WorkspaceEdn.cpp)
target_include_directories(workspace_edn PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/../../crates/ffi/include)

set(core ${CMAKE_CURRENT_SOURCE_DIR}/src/main/jniLibs/${ANDROID_ABI}/libworkspace_edn_ffi.so)
if(NOT EXISTS ${core})
  message(FATAL_ERROR "No formula core for ${ANDROID_ABI} at ${core}: run edn/js/build-android.sh")
endif()
add_library(workspace_edn_ffi SHARED IMPORTED)
set_target_properties(workspace_edn_ffi PROPERTIES IMPORTED_LOCATION ${core})

# Android 15 devices may use 16 KB pages; the NDK before r28 aligns to 4 KB.
target_link_options(workspace_edn PRIVATE "-Wl,-z,max-page-size=16384")

target_link_libraries(workspace_edn
  workspace_edn_ffi
  ReactAndroid::reactnative
  ReactAndroid::jsi
  fbjni::fbjni
)
