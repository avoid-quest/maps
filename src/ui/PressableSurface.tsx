import type { ReactNode } from "react";
import { Pressable, View, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

/**
 * A pressable with Android ripple feedback over a themed fill.
 *
 * React Native 0.81's new background drawables add `android_ripple` as a "feedback underlay": the
 * setter builds a new CompositeBackgroundDrawable around the existing background layer and discards
 * it (BackgroundStyleApplicator.setFeedbackUnderlay). Creating that drawable takes over the
 * background layer's invalidation callback, so a later backgroundColor/borderColor change on the
 * same view is not redrawn: after a live light/dark switch the fill stayed one switch behind until
 * the app restarted (reproduced on Android 16, any ripple, bounded or borderless).
 *
 * So the colours live on this wrapping View, which has no ripple, and the ripple lives on an inner
 * Pressable that never has a background colour or border. Use this for every pressable with a fill
 * or border; a test rejects `android_ripple` anywhere else.
 */
export function PressableSurface({ surfaceStyle, className, contentClassName, rippleColor, borderless = false, children, ...pressable }: Omit<PressableProps, "style" | "children" | "android_ripple"> & {
  /** Fill, border, radius and opacity of the surface (inline, from the resolved palette). */
  surfaceStyle?: StyleProp<ViewStyle>;
  /** Layout of the surface: size, radius, self-alignment. `overflow-hidden` is added to clip the ripple. */
  className?: string;
  /** Layout of the content inside the surface. */
  contentClassName?: string;
  rippleColor: string;
  borderless?: boolean;
  children: ReactNode;
}) {
  return (
    // justify-center keeps the content centred when a row stretches the surface (a taller sibling).
    // The content must not grow: inside a scroll view a growable child absorbs the scroll content's
    // spare height during the sheet's first layout pass (an outlined button became screen-tall).
    <View style={surfaceStyle} className={`justify-center overflow-hidden ${className ?? ""}`}>
      <Pressable android_ripple={{ color: rippleColor, borderless }} className={contentClassName} {...pressable}>
        {children}
      </Pressable>
    </View>
  );
}
