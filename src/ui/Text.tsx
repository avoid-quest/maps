import { Children, type ReactNode } from "react";
import { Text as NativeText, type TextProps } from "react-native";
import { numericRuns } from "./numeric-runs";

const explicitFamily = /(^|\s)font-(sans|mono|display)(\s|$)/;

/**
 * Text in the brand face. React Native has no inherited default font, so every string goes through
 * this component: Geist Sans unless the class names Geist Mono (`font-mono`, numbers and codes) or
 * Mona Sans (`font-display`, large titles and departure minutes). Font scaling stays enabled.
 */
export function Text({ className, ...props }: TextProps & { className?: string }) {
  return <NativeText className={explicitFamily.test(className ?? "") ? className : `font-sans ${className ?? ""}`} {...props} />;
}

/**
 * Times, minutes, distances, stop codes and accuracy: digits in Geist Mono with tabular figures;
 * spaces, colons and units in Geist Sans so "64 m" and "23:33" stay tight (see numeric-runs.ts).
 */
export function Num({ className, style, children, ...props }: TextProps & { className?: string }) {
  const parts = Children.toArray(children).flatMap((child): ReactNode[] => typeof child === "string" || typeof child === "number"
    ? numericRuns(String(child)).map((run, index) => run.numeric ? run.text : <NativeText key={`${index}:${run.text}`} className="font-sans">{run.text}</NativeText>)
    : [child]);
  return <NativeText className={`font-mono ${className ?? ""}`} style={[{ fontVariant: ["tabular-nums"] }, style]} {...props}>{parts}</NativeText>;
}

/** Large display text: Mona Sans, heavy and tight (letter-spacing about -0.04 em). */
export function Display({ className, style, size = 22, ...props }: TextProps & { className?: string; size?: number }) {
  return <NativeText className={`font-display font-extrabold ${className ?? ""}`} style={[{ fontSize: size, lineHeight: Math.round(size * 1.15), letterSpacing: -0.04 * size, fontVariant: ["tabular-nums"] }, style]} {...props} />;
}
