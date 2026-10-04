# Runner character

`runner.glb` is the **Xbot character from Mixamo**, including skeletal `idle`, `walk`, and `run` animations, distributed in the official Three.js r170 additive-animation example.

- Source asset: https://github.com/mrdoob/three.js/blob/r170/examples/models/gltf/Xbot.glb
- Source example and explicit Mixamo credit: https://github.com/mrdoob/three.js/blob/r170/examples/webgl_animation_skinning_additive_blending.html
- Creator/service: https://www.mixamo.com/
- Usage FAQ: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html

The character is used as an embedded player in this game. This is not an asset pack; Adobe/Mixamo rights and terms still apply to the character and motion data. The game's source-code license does not relicense those assets.

The animation controller uses the supplied idle/walk/run skeletal clips and procedural joint poses for jump and slide. To use another Mixamo character, export an animated GLB with the same clip names and replace `runner.glb` (or change `character.js`). The model is normalized to the game's player height at load time.
