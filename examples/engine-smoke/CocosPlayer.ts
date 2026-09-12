// Cocos Creator 3.8.x / Spine 3.8. Drag the exported JSON asset onto this component.
import { _decorator, Component, sp } from 'cc';
const { ccclass, property } = _decorator;
@ccclass('BoneStudioPlayer')
export class BoneStudioPlayer extends Component {
  @property(sp.SkeletonData) data: sp.SkeletonData | null = null;
  @property clip = 'idle';
  start(): void {
    if (!this.data) { console.error('Assign exported Spine SkeletonData first.'); return; }
    const skeleton = this.getComponent(sp.Skeleton) || this.addComponent(sp.Skeleton);
    skeleton.skeletonData = this.data;
    skeleton.premultipliedAlpha = false;
    skeleton.setAnimation(0, this.clip, true);
  }
}
