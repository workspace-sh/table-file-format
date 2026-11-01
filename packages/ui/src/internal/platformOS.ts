/**
 * Native (iOS, Android, macOS): the platform React Native reports. The web
 * has `platformOS.web.ts`, so the shared views never import react-native
 * there, which the web build can't load.
 */
import { Platform } from "react-native";

export const PLATFORM_OS: string = Platform.OS;
