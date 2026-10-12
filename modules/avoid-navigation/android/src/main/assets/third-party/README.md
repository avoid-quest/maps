# Navigation dependency notices

`navigation-notices.json` contains original publisher notice texts and source references. The Android library packages it under `assets/third-party`; **Privacy e fonti → Licenze dei componenti di navigazione** reads the same file through the application bundle, making the texts available offline. Inspect both copies in the final release APK.

The inventory covers Ferrostar core 0.57.0, JNA 5.18.1 and its native dispatch/libffi notices, the 40 Maven coordinates added/upgraded by the pinned core, desugar_jdk_libs 2.1.5, and 123 crates in the tagged Ferrostar Android normal/build dependency closure (Ferrostar appears once). The current resolved Android runtime graph contains 137 external components and equals the inspected core compatibility graph. Metadata-only BOMs retain POM declarations. Existing application dependencies, datasets and hosted-service policies remain separate inventories.

Rust entries conservatively retain source/build dependencies and both alternative licence texts where supplied. They are not proof that every listed crate is linked into the publisher's prebuilt library. Notice texts are deduplicated by SHA-256; components reference their original texts and immutable versioned source downloads. Missing crate archive texts were retrieved from the exact commit recorded by that crate's `.cargo_vcs_info.json`.

## Source availability

Unmodified UniFFI 0.31.1 components declare MPL-2.0. Each entry exposes its complete versioned crate source download. Ferrostar's published AAR declares BSD-3-Clause and JNA declares Apache-2.0 OR LGPL-2.1-or-later; their original texts and JNA's two licence choices are preserved without assigning a licence to the original application source.

The desugar_jdk_libs 2.1.5 POM declares **GPL-2.0 with the Classpath Exception**. Preserve the complete GPL/exception text, `ADDITIONAL_LICENSE_INFO` and `ASSEMBLY_EXCEPTION`. Its official source snapshot at `73170c345e6a762fc6a1f0301bb15218850023ef` identifies `VERSION_JDK11.txt=2.1.5`, the 2.1.5 changelog and upstream BUILD/scripts. Source archive and build metadata must accompany the APK from the same release download location; retain the application's public config plugin and build scripts for the D8/L8 transformation. An upstream link alone is not the completed release source-delivery check. No bit-for-bit publisher rebuild has been established.

## Updating and verification

When changing the core or desugaring version, capture the actual release-runtime coordinates/artifact hashes and POM declarations, original AAR/JAR notices and the tagged Android Rust normal/build dependency closure using its Cargo lockfile/default `std,uniffi` features. Preserve separate source references for every MPL component and desugared OpenJDK snapshot. Regenerate the notice mapping with exact original text bytes, and verify each SHA-256 and component reference.

Before distribution, check that the APK contains `assets/third-party/navigation-notices.json`, that Privacy e fonti can read its complete texts offline, and that the complete source archive and checksum are downloadable alongside that exact APK. Recheck native permissions, Google-free location/dependency graph, bundled release JavaScript, signing continuity and 16 KB alignment. See [navigation acceptance](../../../../../../../docs/development/navigation.md) for source/runtime limits.
