/**
 * The one place the game imports Babylon.js core from.
 *
 * The package's main entry ("@babylonjs/core") pulls in every module Babylon has, about 6 MB of
 * script. Importing each class from its own module lets the bundler leave the rest out. Each
 * module below is the registering variant (not `.pure`), so it installs its own side effects.
 * Scene components that are only reached through methods on `Scene` (shadows, physics, layers,
 * post-process pipelines, animation) have no class to import and are listed at the end.
 *
 * A missing component shows at run time, usually as "X needs to be imported" or an undefined
 * method on the scene: add its module here. `sim` must never import this file.
 */
export { Engine } from "@babylonjs/core/Engines/engine";
export { Scene } from "@babylonjs/core/scene";
export { Node } from "@babylonjs/core/node";
export { AssetContainer } from "@babylonjs/core/assetContainer";
export { LoadAssetContainerAsync } from "@babylonjs/core/Loading/sceneLoader";
export { EngineInstrumentation } from "@babylonjs/core/Instrumentation/engineInstrumentation";

export { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
export { Vector3 } from "@babylonjs/core/Maths/math.vector";

export { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
export { Mesh } from "@babylonjs/core/Meshes/mesh";
export { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
export { TransformNode } from "@babylonjs/core/Meshes/transformNode";
export { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";

export { Camera } from "@babylonjs/core/Cameras/camera";
export { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";

export { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
export { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
export { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";

export { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
export { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
export { Texture } from "@babylonjs/core/Materials/Textures/texture";
export { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
export { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";

export { AnimationGroup } from "@babylonjs/core/Animations/animationGroup";
export { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
export { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
export { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";

export { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
export { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
export { PhysicsBody } from "@babylonjs/core/Physics/v2/physicsBody";
export { PhysicsShape, PhysicsShapeHeightField } from "@babylonjs/core/Physics/v2/physicsShape";
export { PhysicsMotionType, PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
export { PhysicsCharacterController, CharacterSupportedState } from "@babylonjs/core/Physics/v2/characterController";
export { PhysicsRaycastResult } from "@babylonjs/core/Physics/physicsRaycastResult";

// Scene components with no class of their own to import.
import "@babylonjs/core/Animations/animatable";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Layers/effectLayerSceneComponent";
import "@babylonjs/core/Physics/v2/physicsEngineComponent";
import "@babylonjs/core/Physics/joinedPhysicsEngineComponent";
import "@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipelineManagerSceneComponent";
import "@babylonjs/core/Particles/particleSystemComponent";
import "@babylonjs/core/Culling/ray";
