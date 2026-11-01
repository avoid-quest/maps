# Defensive keep rules for release minification (the app is not minified today).
# UniFFI bindings and JNA resolve native callbacks, structures and libraries reflectively.
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
-keep class uniffi.** { *; }
-keep class com.stadiamaps.ferrostar.** { *; }
-dontwarn java.awt.**
-dontwarn com.sun.jna.**
# Expo Modules instantiates the module and converts bridge records reflectively.
-keep class quest.avoid.maps.navigation.AvoidNavigationModule { *; }
-keep class quest.avoid.maps.navigation.NavigationService { *; }
