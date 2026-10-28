# Third-party notices

## Ziwei Doushu chart engine

- Project: [Renhuai123/ziwei-doushu](https://github.com/Renhuai123/ziwei-doushu)
- Revision: `ff9a1470ebe652e57b9d690f5d01db9a04f47aae`
- Copyright: © 2026 紫微研究
- License: MIT; full notice retained at [src/lib/ziwei/LICENSE](src/lib/ziwei/LICENSE)
- Provenance: [src/lib/ziwei/SOURCE.md](src/lib/ziwei/SOURCE.md)

Seven TypeScript files from the upstream `lib/ziwei` directory are included in `src/lib/ziwei/`: `algorithm.ts`, `constants.ts`, `lunar-javascript.d.ts`, `school-config.ts`, `school-data.ts`, `school-tables.generated.ts`, and `types.ts`. The application adapter, interface and AI request flow are separate additions.

The upstream interpretation dataset and noncommercial lecture corpus are not bundled. This project does not claim ownership of the upstream engine or endorsement from its author.

## Package dependencies

Runtime and build dependencies are resolved through npm and recorded in `package-lock.json`. Each package retains its own license and copyright notice, available in its installed package directory and upstream repository. The root MIT license does not replace those notices.

## Visual references

The following are design references, not copied website assets or bundled third-party code:

- [Lusion](https://lusion.co/): immersive composition and scene-based interaction.
- [Hallmark](https://github.com/Nutlope/hallmark): avoiding generic AI-generated interface patterns.
- [Impeccable](https://github.com/pbakaus/impeccable): visual hierarchy, typography and interaction refinement.
- [AI Design Skills](https://github.com/elayadesign/ai-design-skills): design workflows and landing-page critique.

The application's background illustration is created for this project. See [asset provenance](docs/assets.md). Reference websites' images, video, logos and proprietary artwork are not distributed here.

## Noto Serif SC font

- Copyright 2012 Google Inc. All Rights Reserved.
- License: SIL Open Font License 1.1, retained in full at [public/assets/fonts/OFL.txt](public/assets/fonts/OFL.txt).
- Source: [Google Fonts](https://fonts.google.com/noto/specimen/Noto+Serif+SC) and its [official license](https://github.com/google/fonts/blob/main/ofl/notoserifsc/OFL.txt).
- The 400-weight font was subset for the application with FontTools and distributed as `public/assets/fonts/noto-serif-sc-400.woff2`. The font license is independent of the project's MIT code license.
