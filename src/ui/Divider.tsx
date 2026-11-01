import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useThemeColors } from "../theme/ThemeProvider";
import { floatingControlColors, rowDividerColors } from "./control-styles";

/**
 * Hairline borders and floating-surface colours as inline styles from the resolved palette. Used
 * instead of `border-divider` / `bg-surface-raised` classes on rows and map overlays, which did not
 * repaint on Android after a live scheme switch.
 */
export function useHairlines() {
  const colors = useThemeColors();
  return useMemo(() => {
    const color = rowDividerColors(colors).borderBottomColor;
    const floating = floatingControlColors(colors, false);
    return {
      bottom: { borderBottomColor: color, borderBottomWidth: StyleSheet.hairlineWidth },
      top: { borderTopColor: color, borderTopWidth: StyleSheet.hairlineWidth },
      box: { borderColor: color, borderWidth: StyleSheet.hairlineWidth },
      /** A surface floating over the map: raised fill with a hairline, no shadow. */
      floating: { backgroundColor: floating.backgroundColor, borderColor: floating.borderColor, borderWidth: StyleSheet.hairlineWidth },
    };
  }, [colors]);
}

/** A full-width hairline between sections. */
export function Divider({ inset = 0 }: { inset?: number }) {
  const { top } = useHairlines();
  return <View style={[top, { marginHorizontal: inset }]} />;
}
