// LayaAir 3.x: select Spine 3.8 in Project Settings -> Engine Modules first.
// Resource .json, .atlas and .png must remain together. See IMPORT.md for alpha settings.
export async function mountBoneStudio(parent: Laya.Sprite, jsonUrl: string, clip = 'idle'): Promise<Laya.Sprite> {
  await Laya.loader.load(jsonUrl, Laya.Loader.SPINE);
  const node = new Laya.Sprite(); parent.addChild(node);
  const renderer = node.addComponent(Laya.Spine2DRenderNode);
  renderer.source = jsonUrl;
  renderer.skinName = 'default';
  renderer.play(clip, true);
  return node;
}
