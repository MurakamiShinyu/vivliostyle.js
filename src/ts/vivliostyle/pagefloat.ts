/**
 * Copyright 2015 Trim-marks Inc.
 *
 * Vivliostyle.js is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Vivliostyle.js is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Vivliostyle.js.  If not, see <http://www.gnu.org/licenses/>.
 *
 * @fileoverview CSS Page Floats
 */
import * as base from '../adapt/base';
import {Numeric, ident} from '../adapt/css';
import {Val} from '../adapt/css';
import * as geom from '../adapt/geom';
import {LayoutConstraint} from '../adapt/layout';
import {PageFloatArea} from '../adapt/layout';
import {Column} from '../adapt/layout';
import * as task from '../adapt/task';
import * as vtree from '../adapt/vtree';
import * as asserts from '../closure/goog/asserts/asserts';

import * as logging from './logging';
import * as logical from './logical';
import {Size, getSize} from './sizing'

/**
 * @enum {string}
 */
export enum FloatReference {
  INLINE = 'inline',
  COLUMN = 'column',
  REGION = 'region',
  PAGE = 'page'
}
const FloatReference = FloatReference;
FloatReference.of = (str: string): FloatReference => {
  switch (str) {
    case 'inline':
      return FloatReference.INLINE;
    case 'column':
      return FloatReference.COLUMN;
    case 'region':
      return FloatReference.REGION;
    case 'page':
      return FloatReference.PAGE;
    default:
      throw new Error(`Unknown float-reference: ${str}`);
  }
};

export const isPageFloat = (floatReference: FloatReference): boolean => {
  switch (floatReference) {
    case FloatReference.INLINE:
      return false;
    case FloatReference.COLUMN:
    case FloatReference.REGION:
    case FloatReference.PAGE:
      return true;
    default:
      throw new Error(`Unknown float-reference: ${floatReference}`);
  }
};

/**
 * Interpret a float value with the writing-mode and direction assuming the
 * float-reference is inline and returns "left" or "right".
 */
export const resolveInlineFloatDirection =
    (floatSide: string, vertical: boolean, direction: string): string => {
      const writingMode = vertical ? 'vertical-rl' : 'horizontal-tb';
      if (floatSide === 'top' || floatSide === 'bottom') {
        floatSide = logical.toLogical(floatSide, writingMode, direction);
      }
      if (floatSide === 'block-start') {
        floatSide = 'inline-start';
      }
      if (floatSide === 'block-end') {
        floatSide = 'inline-end';
      }
      if (floatSide === 'inline-start' || floatSide === 'inline-end') {
        const physicalValue =
            logical.toPhysical(floatSide, writingMode, direction);
        const lineRelativeValue =
            logical.toLineRelative(physicalValue, writingMode);
        if (lineRelativeValue === 'line-left') {
          floatSide = 'left';
        } else {
          if (lineRelativeValue === 'line-right') {
            floatSide = 'right';
          }
        }
      }
      if (floatSide !== 'left' && floatSide !== 'right') {
        logging.logger.warn(
            `Invalid float value: ${floatSide}. Fallback to left.`);
        floatSide = 'left';
      }
      return floatSide;
    };

export class PageFloat {
  private order: number|null = null;
  private id: PageFloat.ID|null = null;

  constructor(
      public readonly nodePosition: vtree.NodePosition,
      public readonly floatReference: FloatReference,
      public readonly floatSide: string, public readonly clearSide: string|null,
      public readonly flowName: string,
      public readonly floatMinWrapBlock: Numeric|null) {}

  getOrder(): number {
    if (this.order === null) {
      throw new Error('The page float is not yet added');
    }
    return this.order;
  }

  getId(): PageFloat.ID {
    if (!this.id) {
      throw new Error('The page float is not yet added');
    }
    return this.id;
  }

  isAllowedOnContext(pageFloatLayoutContext: PageFloatLayoutContext): boolean {
    return pageFloatLayoutContext.isAnchorAlreadyAppeared(this.getId());
  }

  isAllowedToPrecede(other: PageFloat): boolean false
}
const PageFloat = PageFloat;
type ID = string;

export class PageFloatStore {
  private floats: PageFloat[] = [];
  private nextPageFloatIndex: number = 0;

  private nextOrder(): number {
    return this.nextPageFloatIndex++;
  }

  private createPageFloatId(order: number): PageFloat.ID`pf${order}`

  addPageFloat(float: PageFloat) {
    const index = this.floats.findIndex(
        (f) => vtree.isSameNodePosition(f.nodePosition, float.nodePosition));
    if (index >= 0) {
      throw new Error(
          'A page float with the same source node is already registered');
    } else {
      const order = float.order = this.nextOrder();
      float.id = this.createPageFloatId(order);
      this.floats.push(float);
    }
  }

  findPageFloatByNodePosition(nodePosition: vtree.NodePosition): PageFloat
      |null {
    const index = this.floats.findIndex(
        (f) => vtree.isSameNodePosition(f.nodePosition, nodePosition));
    return index >= 0 ? this.floats[index] : null;
  }

  findPageFloatById(id: PageFloat.ID) {
    const index = this.floats.findIndex((f) => f.id === id);
    return index >= 0 ? this.floats[index] : null;
  }
}
const PageFloatStore = PageFloatStore;

/**
 * @param continues Represents whether the float is fragmented and continues
 *     after this fragment
 */
export class PageFloatFragment {
  constructor(
      public readonly floatReference: FloatReference,
      public readonly floatSide: string,
      public readonly continuations: PageFloatContinuation[],
      public readonly area: vtree.Container,
      public readonly continues: boolean) {}

  hasFloat(float: PageFloat): boolean {
    return this.continuations.some((c) => c.float === float);
  }

  findNotAllowedFloat(context: PageFloatLayoutContext): PageFloat|null {
    for (let i = this.continuations.length - 1; i >= 0; i--) {
      const f = this.continuations[i].float;
      if (!f.isAllowedOnContext(context)) {
        return f;
      }
    }
    return null;
  }

  getOuterShape(): geom.Shape {
    return this.area.getOuterShape(null, null);
  }

  getOuterRect(): geom.Rect {
    return this.area.getOuterRect();
  }

  getOrder(): number {
    const floats = this.continuations.map((c) => c.float);
    return Math.min.apply(null, floats.map((f) => f.getOrder()));
  }

  shouldBeStashedBefore(float: PageFloat): boolean {
    return this.getOrder() < float.getOrder();
  }

  addContinuations(continuations: PageFloatContinuation[]) {
    continuations.forEach(function(c) {
      this.continuations.push(c);
    }, this);
  }

  getFlowName(): string {
    const flowName = this.continuations[0].float.flowName;
    asserts.assert(
        this.continuations.every((c) => c.float.flowName === flowName));
    return flowName;
  }
}
const PageFloatFragment = PageFloatFragment;

export class PageFloatContinuation {
  constructor(
      public readonly float: PageFloat,
      public readonly nodePosition: vtree.NodePosition) {}

  equals(other: PageFloatContinuation|null): boolean {
    if (!other) {
      return false;
    }
    if (this === other) {
      return true;
    }
    return this.float === other.float &&
        vtree.isSameNodePosition(this.nodePosition, other.nodePosition);
  }
}
const PageFloatContinuation = PageFloatContinuation;
type PageFloatPlacementCondition = {
  [key: string]: boolean
};

export {PageFloatPlacementCondition};
const PageFloatPlacementCondition = PageFloatPlacementCondition;

/**
 * @param generatingNodePosition Source NodePosition generating the context.
 *     Specify when a column context is generated by a non-root element (for
 *     example page floats)
 */
export class PageFloatLayoutContext {
  private children: PageFloatLayoutContext[] = [];
  writingMode: Val;
  direction: Val;
  private invalidated: boolean = false;
  private floatStore: any;
  private forbiddenFloats: PageFloat.ID[] = [];
  floatFragments: PageFloatFragment[] = [];
  private stashedFloatFragments: PageFloatFragment[] = [];
  private floatAnchors: {[key: PageFloat.ID]: Node} = {};
  private floatsDeferredToNext: PageFloatContinuation[] = [];
  private floatsDeferredFromPrevious: PageFloatContinuation[];
  private layoutConstraints: LayoutConstraint[] = [];
  private locked: boolean = false;
  container: any;

  constructor(
      public readonly parent: PageFloatLayoutContext,
      private readonly floatReference: FloatReference|null,
      private container: vtree.Container, public readonly flowName: string|null,
      public readonly generatingNodePosition: vtree.NodePosition|null,
      writingMode: Val|null, direction: Val|null) {
    if (parent) {
      parent.children.push(this);
    }
    this.writingMode = writingMode || parent && parent.writingMode ||
        ident.horizontal_tb;
    this.direction =
        direction || parent && parent.direction || ident.ltr;
    this.floatStore = parent ? parent.floatStore : new PageFloatStore();
    const previousSibling = this.getPreviousSibling();
    this.floatsDeferredFromPrevious =
        previousSibling ? [].concat(previousSibling.floatsDeferredToNext) : [];
  }

  private getParent(floatReference: FloatReference): PageFloatLayoutContext {
    if (!this.parent) {
      throw new Error(`No PageFloatLayoutContext for ${floatReference}`);
    }
    return this.parent;
  }

  private getPreviousSiblingOf(
      child: PageFloatLayoutContext|null, floatReference: FloatReference|null,
      flowName: string|null, generatingNodePosition: vtree.NodePosition|null):
      PageFloatLayoutContext|null {
    let index = this.children.indexOf((child as PageFloatLayoutContext));
    if (index < 0) {
      index = this.children.length;
    }
    for (let i = index - 1; i >= 0; i--) {
      let result = this.children[i];
      if (result.floatReference === floatReference &&
          result.flowName === flowName &&
          vtree.isSameNodePosition(
              result.generatingNodePosition, generatingNodePosition)) {
        return result;
      } else {
        result = result.getPreviousSiblingOf(
            null, floatReference, flowName, generatingNodePosition);
        if (result) {
          return result;
        }
      }
    }
    return null;
  }

  private getPreviousSibling(): PageFloatLayoutContext|null {
    let child = this;
    let parent = this.parent;
    let result;
    while (parent) {
      result = parent.getPreviousSiblingOf(
          child, this.floatReference, this.flowName,
          this.generatingNodePosition);
      if (result) {
        return result;
      }
      child = parent;
      parent = parent.parent;
    }
    return null;
  }

  getContainer(floatReference?: FloatReference): vtree.Container {
    if (!floatReference || floatReference === this.floatReference) {
      return this.container;
    }
    return this.getParent(floatReference).getContainer(floatReference);
  }

  setContainer(container: vtree.Container) {
    this.container = container;
    this.reattachFloatFragments();
  }

  addPageFloat(float: PageFloat) {
    this.floatStore.addPageFloat(float);
  }

  getPageFloatLayoutContext(floatReference: FloatReference):
      PageFloatLayoutContext {
    if (floatReference === this.floatReference) {
      return this;
    }
    return this.getParent(floatReference)
        .getPageFloatLayoutContext(floatReference);
  }

  findPageFloatByNodePosition(nodePosition: vtree.NodePosition): PageFloat
      |null {
    return this.floatStore.findPageFloatByNodePosition(nodePosition);
  }

  private forbid(float: PageFloat) {
    const id = float.getId();
    const floatReference = float.floatReference;
    if (floatReference === this.floatReference) {
      if (!this.forbiddenFloats.includes(id)) {
        this.forbiddenFloats.push(id);
        const strategy =
            (new PageFloatLayoutStrategyResolver()).findByFloat(float);
        strategy.forbid(float, this);
      }
    } else {
      const parent = this.getParent(floatReference);
      parent.forbid(float);
    }
  }

  isForbidden(float: PageFloat): boolean {
    const id = float.getId();
    const floatReference = float.floatReference;
    if (floatReference === this.floatReference) {
      return this.forbiddenFloats.includes(id);
    } else {
      const parent = this.getParent(floatReference);
      return parent.isForbidden(float);
    }
  }

  addPageFloatFragment(
      floatFragment: PageFloatFragment, dontInvalidate?: boolean) {
    const floatReference = floatFragment.floatReference;
    if (floatReference !== this.floatReference) {
      const parent = this.getParent(floatReference);
      parent.addPageFloatFragment(floatFragment, dontInvalidate);
    } else {
      if (!this.floatFragments.includes(floatFragment)) {
        this.floatFragments.push(floatFragment);
        this.floatFragments.sort((fr1, fr2) => fr1.getOrder() - fr2.getOrder());
      }
    }
    if (!dontInvalidate) {
      this.invalidate();
    }
  }

  removePageFloatFragment(
      floatFragment: PageFloatFragment, dontInvalidate?: boolean) {
    const floatReference = floatFragment.floatReference;
    if (floatReference !== this.floatReference) {
      const parent = this.getParent(floatReference);
      parent.removePageFloatFragment(floatFragment, dontInvalidate);
    } else {
      const index = this.floatFragments.indexOf(floatFragment);
      if (index >= 0) {
        const fragment = this.floatFragments.splice(index, 1)[0];
        const element = fragment.area && fragment.area.element;
        if (element && element.parentNode) {
          element.parentNode.removeChild(element);
        }
        if (!dontInvalidate) {
          this.invalidate();
        }
      }
    }
  }

  findPageFloatFragment(float: PageFloat): PageFloatFragment|null {
    if (float.floatReference !== this.floatReference) {
      const parent = this.getParent(float.floatReference);
      return parent.findPageFloatFragment(float);
    }
    const index = this.floatFragments.findIndex((f) => f.hasFloat(float));
    if (index >= 0) {
      return this.floatFragments[index];
    } else {
      return null;
    }
  }

  hasFloatFragments(condition?: (p1: PageFloatFragment) => boolean): boolean {
    if (this.floatFragments.length > 0) {
      if (!condition || this.floatFragments.some(condition)) {
        return true;
      }
    }
    if (this.parent) {
      return this.parent.hasFloatFragments(condition);
    } else {
      return false;
    }
  }

  hasContinuingFloatFragmentsInFlow(flowName: string): boolean {
    return this.hasFloatFragments(
        (fragment) =>
            fragment.continues && fragment.getFlowName() === flowName);
  }

  registerPageFloatAnchor(float: PageFloat, anchorViewNode: Node) {
    this.floatAnchors[float.getId()] = anchorViewNode;
  }

  collectPageFloatAnchors() {
    const anchors = Object.assign({}, this.floatAnchors);
    return this.children.reduce(
        (prev, child) => Object.assign(prev, child.collectPageFloatAnchors()),
        anchors);
  }

  private isAnchorAlreadyAppeared(floatId: PageFloat.ID) {
    const deferredFloats = this.getDeferredPageFloatContinuations();
    if (deferredFloats.some((cont) => cont.float.getId() === floatId)) {
      return true;
    }
    const floatAnchors = this.collectPageFloatAnchors();
    const anchorViewNode = floatAnchors[floatId];
    if (!anchorViewNode) {
      return false;
    }
    if (this.container && this.container.element) {
      return this.container.element.contains(anchorViewNode);
    }
    return false;
  }

  deferPageFloat(continuation: PageFloatContinuation) {
    const float = continuation.float;
    if (float.floatReference === this.floatReference) {
      const index =
          this.floatsDeferredToNext.findIndex((c) => c.float === float);
      if (index >= 0) {
        this.floatsDeferredToNext.splice(index, 1, continuation);
      } else {
        this.floatsDeferredToNext.push(continuation);
      }
    } else {
      const parent = this.getParent(float.floatReference);
      parent.deferPageFloat(continuation);
    }
  }

  hasPrecedingFloatsDeferredToNext(float: PageFloat, ignoreReference?: boolean):
      boolean {
    if (!ignoreReference && float.floatReference !== this.floatReference) {
      return this.getParent(float.floatReference)
          .hasPrecedingFloatsDeferredToNext(float, false);
    }
    const order = float.getOrder();
    const hasPrecedingFloatsDeferredToNext = this.floatsDeferredToNext.some(
        (c) =>
            c.float.getOrder() < order && !float.isAllowedToPrecede(c.float));
    if (hasPrecedingFloatsDeferredToNext) {
      return true;
    } else {
      if (this.parent) {
        return this.parent.hasPrecedingFloatsDeferredToNext(float, true);
      } else {
        return false;
      }
    }
  }

  getLastFollowingFloatInFragments(float: PageFloat): PageFloat|null {
    const order = float.getOrder();
    let lastFollowing = null;
    this.floatFragments.forEach((fragment) => {
      fragment.continuations.forEach((c) => {
        const f = c.float;
        const o = f.getOrder();
        if (o > order && (!lastFollowing || o > lastFollowing.getOrder())) {
          lastFollowing = f;
        }
      });
    });
    if (this.parent) {
      const lastFollowingOfParent =
          this.parent.getLastFollowingFloatInFragments(float);
      if (lastFollowingOfParent &&
          (!lastFollowing ||
           lastFollowingOfParent.getOrder() > lastFollowing.getOrder())) {
        lastFollowing = lastFollowingOfParent;
      }
    }
    return lastFollowing;
  }

  getDeferredPageFloatContinuations(flowName?: string|
                                    null): PageFloatContinuation[] {
    flowName = flowName || this.flowName;
    let result = this.floatsDeferredFromPrevious.filter(
        (cont) => !flowName || cont.float.flowName === flowName);
    if (this.parent) {
      result = this.parent.getDeferredPageFloatContinuations(flowName).concat(
          result);
    }
    return result.sort((c1, c2) => c1.float.getOrder() - c2.float.getOrder());
  }

  getPageFloatContinuationsDeferredToNext(flowName?: string|
                                          null): PageFloatContinuation[] {
    flowName = flowName || this.flowName;
    const result = this.floatsDeferredToNext.filter(
        (cont) => !flowName || cont.float.flowName === flowName);
    if (this.parent) {
      return this.parent.getPageFloatContinuationsDeferredToNext(flowName)
          .concat(result);
    } else {
      return result;
    }
  }

  getFloatsDeferredToNextInChildContexts(): PageFloat[] {
    let result = [];
    const done = [];
    for (let i = this.children.length - 1; i >= 0; i--) {
      const child = this.children[i];
      if (done.includes(child.flowName)) {
        continue;
      }
      done.push(child.flowName);
      result = result.concat(child.floatsDeferredToNext.map((c) => c.float));
      result = result.concat(child.getFloatsDeferredToNextInChildContexts());
    }
    return result;
  }

  checkAndForbidNotAllowedFloat(): boolean {
    if (this.checkAndForbidFloatFollowingDeferredFloat()) {
      return true;
    }
    for (let i = this.floatFragments.length - 1; i >= 0; i--) {
      const fragment = this.floatFragments[i];
      const notAllowedFloat = fragment.findNotAllowedFloat(this);
      if (notAllowedFloat) {
        if (this.locked) {
          this.invalidate();
        } else {
          this.removePageFloatFragment(fragment);
          this.forbid(notAllowedFloat);

          // If the removed float is a block-end/inline-end float,
          // we should re-layout preceding floats with the same float direction.
          this.removeEndFloatFragments(fragment.floatSide);
        }
        return true;
      }
    }
    if (this.floatReference === FloatReference.REGION && this.parent.locked) {
      return this.parent.checkAndForbidNotAllowedFloat();
    }
    return false;
  }

  checkAndForbidFloatFollowingDeferredFloat(): boolean {
    const deferredFloats = this.getFloatsDeferredToNextInChildContexts();
    const floatsInFragments = this.floatFragments.reduce(
        (r, fr) => r.concat(fr.continuations.map((c) => c.float)), []);
    floatsInFragments.sort((f1, f2) => f2.getOrder() - f1.getOrder());
    for (const float of floatsInFragments) {
      const order = float.getOrder();
      if (deferredFloats.some(
              (d) => !float.isAllowedToPrecede(d) && order > d.getOrder())) {
        if (this.locked) {
          this.invalidate();
        } else {
          this.forbid(float);
          const fragment = this.findPageFloatFragment(float);
          asserts.assert(fragment);
          this.removePageFloatFragment(fragment);
        }
        return true;
      }
    }
    return false;
  }

  finish() {
    if (this.checkAndForbidNotAllowedFloat()) {
      return;
    }
    for (let i = this.floatsDeferredToNext.length - 1; i >= 0; i--) {
      const continuation = this.floatsDeferredToNext[i];
      if (!continuation.float.isAllowedOnContext(this)) {
        if (this.locked) {
          this.invalidate();
          return;
        }
        this.floatsDeferredToNext.splice(i, 1);
      }
    }
    this.floatsDeferredFromPrevious.forEach(function(continuation) {
      if (this.floatsDeferredToNext.findIndex((c) => continuation.equals(c)) >=
          0) {
        return;
      }
      if (this.floatFragments.some((f) => f.hasFloat(continuation.float))) {
        return;
      }
      this.floatsDeferredToNext.push(continuation);
    }, this);
  }

  hasSameContainerAs(other: PageFloatLayoutContext): boolean {
    return !!this.container && !!other.container &&
        this.container.element === other.container.element;
  }

  invalidate() {
    this.invalidated = true;
    if (this.locked) {
      return;
    }
    if (this.container) {
      this.children.forEach(function(child) {
        // Since the same container element is shared by a region page float
        // layout context and a column page float layout context in a single
        // column region, view elements of float fragments of the child (column)
        // context need to be removed here.
        if (this.hasSameContainerAs(child)) {
          child.floatFragments.forEach((fragment) => {
            const elem = fragment.area.element;
            if (elem && elem.parentNode) {
              elem.parentNode.removeChild(elem);
            }
          });
        }
      }, this);
      this.container.clear();
    }
    this.children.forEach((child) => {
      child.layoutConstraints.splice(0);
    });
    this.children.splice(0);
    Object.keys(this.floatAnchors).forEach(function(k) {
      delete this.floatAnchors[k];
    }, this);
  }

  detachChildren(): PageFloatLayoutContext[] {
    const children = this.children.splice(0);
    children.forEach((child) => {
      child.floatFragments.forEach((fragment) => {
        const elem = fragment.area.element;
        if (elem && elem.parentNode) {
          elem.parentNode.removeChild(elem);
        }
      });
    });
    return children;
  }

  attachChildren(children: PageFloatLayoutContext[]) {
    children.forEach(function(child) {
      this.children.push(child);
      child.reattachFloatFragments();
    }, this);
  }

  isInvalidated() {
    return this.invalidated || !!this.parent && this.parent.isInvalidated();
  }

  validate() {
    this.invalidated = false;
  }

  private toLogical(side: string): string {
    const writingMode = this.writingMode.toString();
    const direction = this.direction.toString();
    return logical.toLogical(side, writingMode, direction);
  }

  private toPhysical(side: string): string {
    const writingMode = this.writingMode.toString();
    const direction = this.direction.toString();
    return logical.toPhysical(side, writingMode, direction);
  }

  removeEndFloatFragments(floatSide: string) {
    const logicalFloatSide = this.toLogical(floatSide);
    if (logicalFloatSide === 'block-end' || logicalFloatSide === 'inline-end') {
      let i = 0;
      while (i < this.floatFragments.length) {
        const fragment = this.floatFragments[i];
        const logicalFloatSide2 = this.toLogical(fragment.floatSide);
        if (logicalFloatSide2 === logicalFloatSide) {
          this.removePageFloatFragment(fragment);
        } else {
          i++;
        }
      }
    }
  }

  stashEndFloatFragments(float: PageFloat) {
    const floatReference = float.floatReference;
    if (floatReference !== this.floatReference) {
      this.getParent(floatReference).stashEndFloatFragments(float);
      return;
    }
    const logicalFloatSide = this.toLogical(float.floatSide);
    if (logicalFloatSide === 'block-end' || logicalFloatSide === 'snap-block' ||
        logicalFloatSide === 'inline-end') {
      let i = 0;
      while (i < this.floatFragments.length) {
        const fragment = this.floatFragments[i];
        const fragmentFloatSide = this.toLogical(fragment.floatSide);
        if ((fragmentFloatSide === logicalFloatSide ||
             logicalFloatSide === 'snap-block' &&
                 fragmentFloatSide === 'block-end') &&
            fragment.shouldBeStashedBefore(float)) {
          this.stashedFloatFragments.push(fragment);
          this.floatFragments.splice(i, 1);
        } else {
          i++;
        }
      }
    }
  }

  restoreStashedFragments(floatReference: FloatReference) {
    if (floatReference !== this.floatReference) {
      this.getParent(floatReference).restoreStashedFragments(floatReference);
      return;
    }
    this.stashedFloatFragments.forEach(function(stashed) {
      this.addPageFloatFragment(stashed, true);
    }, this);
    this.stashedFloatFragments.splice(0);
  }

  discardStashedFragments(floatReference: FloatReference) {
    if (floatReference !== this.floatReference) {
      this.getParent(floatReference).discardStashedFragments(floatReference);
      return;
    }
    this.stashedFloatFragments.splice(0);
  }

  getStashedFloatFragments(floatReference: FloatReference):
      PageFloatFragment[] {
    if (floatReference === this.floatReference) {
      return this.stashedFloatFragments.concat().sort(
          (fr1, fr2) =>
              // return in reverse order
          fr2.getOrder() - fr1.getOrder());
    } else {
      return this.getParent(floatReference)
          .getStashedFloatFragments(floatReference);
    }
  }

  private getLimitValue(
      side: string, layoutContext: vtree.LayoutContext,
      clientLayout: vtree.ClientLayout,
      condition?:
          (p1: PageFloatFragment, p2: PageFloatLayoutContext) => boolean):
      number {
    asserts.assert(this.container);
    const logicalSide = this.toLogical(side);
    const physicalSide = this.toPhysical(side);
    const limit = this.getLimitValueInner(
        logicalSide, layoutContext, clientLayout, condition);
    if (this.parent && this.parent.container) {
      const parentLimit = this.parent.getLimitValue(
          physicalSide, layoutContext, clientLayout, condition);
      switch (physicalSide) {
        case 'top':
          return Math.max(limit, parentLimit);
        case 'left':
          return Math.max(limit, parentLimit);
        case 'bottom':
          return Math.min(limit, parentLimit);
        case 'right':
          return Math.min(limit, parentLimit);
        default:
          asserts.fail('Should be unreachable');
      }
    }
    return limit;
  }

  private getLimitValueInner(
      logicalSide: string, layoutContext: vtree.LayoutContext,
      clientLayout: vtree.ClientLayout,
      condition?:
          (p1: PageFloatFragment, p2: PageFloatLayoutContext) => boolean):
      number {
    asserts.assert(this.container);
    const limits =
        this.getLimitValuesInner(layoutContext, clientLayout, condition);
    switch (logicalSide) {
      case 'block-start':
        return this.container.vertical ? limits.right : limits.top;
      case 'block-end':
        return this.container.vertical ? limits.left : limits.bottom;
      case 'inline-start':
        return this.container.vertical ? limits.top : limits.left;
      case 'inline-end':
        return this.container.vertical ? limits.bottom : limits.right;
      default:
        throw new Error(`Unknown logical side: ${logicalSide}`);
    }
  }

  private getLimitValuesInner(
      layoutContext: vtree.LayoutContext, clientLayout: vtree.ClientLayout,
      condition?:
          (p1: PageFloatFragment, p2: PageFloatLayoutContext) => boolean):
      {top: number, left: number, bottom: number, right: number} {
    asserts.assert(this.container);
    const offsetX = this.container.originX;
    const offsetY = this.container.originY;
    const paddingRect = this.container.getPaddingRect();
    let limits = {
      top: paddingRect.y1 - offsetY,
      left: paddingRect.x1 - offsetX,
      bottom: paddingRect.y2 - offsetY,
      right: paddingRect.x2 - offsetX,
      floatMinWrapBlockStart: 0,
      floatMinWrapBlockEnd: 0
    };

    function resolveLengthPercentage(numeric, viewNode, containerLength) {
      if (numeric.unit === '%') {
        return containerLength * numeric.num / 100;
      } else {
        return layoutContext.convertLengthToPx(numeric, viewNode, clientLayout);
      }
    }
    const fragments = this.floatFragments;
    if (fragments.length > 0) {
      limits = fragments.reduce((l, f) => {
        if (condition && !condition(f, this)) {
          return l;
        }
        const logicalFloatSide = this.toLogical(f.floatSide);
        const area = f.area;
        const floatMinWrapBlock = f.continuations[0].float.floatMinWrapBlock;
        let top = l.top;
        let left = l.left;
        let bottom = l.bottom;
        let right = l.right;
        let floatMinWrapBlockStart = l.floatMinWrapBlockStart;
        let floatMinWrapBlockEnd = l.floatMinWrapBlockEnd;
        switch (logicalFloatSide) {
          case 'inline-start':
            if (area.vertical) {
              top = Math.max(top, area.top + area.height);
            } else {
              left = Math.max(left, area.left + area.width);
            }
            break;
          case 'block-start':
            if (area.vertical) {
              if (floatMinWrapBlock && area.left < right) {
                floatMinWrapBlockStart = resolveLengthPercentage(
                    floatMinWrapBlock, area.rootViewNodes[0],
                    paddingRect.x2 - paddingRect.x1);
              }
              right = Math.min(right, area.left);
            } else {
              if (floatMinWrapBlock && area.top + area.height > top) {
                floatMinWrapBlockStart = resolveLengthPercentage(
                    floatMinWrapBlock, area.rootViewNodes[0],
                    paddingRect.y2 - paddingRect.y1);
              }
              top = Math.max(top, area.top + area.height);
            }
            break;
          case 'inline-end':
            if (area.vertical) {
              bottom = Math.min(bottom, area.top);
            } else {
              right = Math.min(right, area.left);
            }
            break;
          case 'block-end':
            if (area.vertical) {
              if (floatMinWrapBlock && area.left + area.width > left) {
                floatMinWrapBlockEnd = resolveLengthPercentage(
                    floatMinWrapBlock, area.rootViewNodes[0],
                    paddingRect.x2 - paddingRect.x1);
              }
              left = Math.max(left, area.left + area.width);
            } else {
              if (floatMinWrapBlock && area.top < bottom) {
                floatMinWrapBlockEnd = resolveLengthPercentage(
                    floatMinWrapBlock, area.rootViewNodes[0],
                    paddingRect.y2 - paddingRect.y1);
              }
              bottom = Math.min(bottom, area.top);
            }
            break;
          default:
            throw new Error(`Unknown logical float side: ${logicalFloatSide}`);
        }
        return {
          top,
          left,
          bottom,
          right,
          floatMinWrapBlockStart,
          floatMinWrapBlockEnd
        };
      }, limits);
    }
    limits.left += offsetX;
    limits.right += offsetX;
    limits.top += offsetY;
    limits.bottom += offsetY;
    return limits;
  }

  /**
   * @param anchorEdge Null indicates that the anchor is not in the current
   *     container.
   * @return Logical float side (snap-block is resolved when init=false). Null
   *     indicates that the float area does not fit inside the container
   */
  setFloatAreaDimensions(
      area: PageFloatArea, floatReference: FloatReference, floatSide: string,
      anchorEdge: number|null, init: boolean, force: boolean,
      condition: PageFloatPlacementCondition): string|null {
    if (floatReference !== this.floatReference) {
      const parent = this.getParent(floatReference);
      return parent.setFloatAreaDimensions(
          area, floatReference, floatSide, anchorEdge, init, force, condition);
    }
    let logicalFloatSide = this.toLogical(floatSide);
    if (logicalFloatSide === 'snap-block') {
      if (!condition['block-start'] && !condition['block-end']) {
        return null;
      }
    } else {
      if (!condition[logicalFloatSide]) {
        return null;
      }
    }
    asserts.assert(area.clientLayout);
    let blockStart = this.getLimitValue(
        'block-start', area.layoutContext, area.clientLayout);
    let blockEnd =
        this.getLimitValue('block-end', area.layoutContext, area.clientLayout);
    let inlineStart = this.getLimitValue(
        'inline-start', area.layoutContext, area.clientLayout);
    let inlineEnd =
        this.getLimitValue('inline-end', area.layoutContext, area.clientLayout);
    const blockOffset = area.vertical ? area.originX : area.originY;
    const inlineOffset = area.vertical ? area.originY : area.originX;
    blockStart = area.vertical ?
        Math.min(
            blockStart,
            area.left + area.getInsetLeft() + area.width +
                area.getInsetRight() + blockOffset) :
        Math.max(blockStart, area.top + blockOffset);
    blockEnd = area.vertical ? Math.max(blockEnd, area.left + blockOffset) :
                               Math.min(
                                   blockEnd,
                                   area.top + area.getInsetTop() + area.height +
                                       area.getInsetBottom() + blockOffset);

    function limitBlockStartEndValueWithOpenRect(getRect, rect) {
      let openRect = getRect(area.bands, rect);
      if (openRect) {
        if (area.vertical) {
          openRect = geom.unrotateBox(openRect);
        }
        blockStart = area.vertical ? Math.min(blockStart, openRect.x2) :
                                     Math.max(blockStart, openRect.y1);
        blockEnd = area.vertical ? Math.max(blockEnd, openRect.x1) :
                                   Math.min(blockEnd, openRect.y2);
        return true;
      } else {
        return force;
      }
    }
    let blockSize;
    let inlineSize;
    let outerBlockSize;
    let outerInlineSize;
    if (init) {
      const rect = area.vertical ?
          geom.rotateBox(
              new geom.Rect(blockEnd, inlineStart, blockStart, inlineEnd)) :
          new geom.Rect(inlineStart, blockStart, inlineEnd, blockEnd);
      if (logicalFloatSide === 'block-start' ||
          logicalFloatSide === 'snap-block' ||
          logicalFloatSide === 'inline-start') {
        if (!limitBlockStartEndValueWithOpenRect(
                geom.findUppermostFullyOpenRect, rect)) {
          return null;
        }
      }
      if (logicalFloatSide === 'block-end' ||
          logicalFloatSide === 'snap-block' ||
          logicalFloatSide === 'inline-end') {
        if (!limitBlockStartEndValueWithOpenRect(
                geom.findBottommostFullyOpenRect, rect)) {
          return null;
        }
      }
      outerBlockSize = (blockEnd - blockStart) * area.getBoxDir();
      blockSize = outerBlockSize - area.getInsetBefore() - area.getInsetAfter();
      outerInlineSize = inlineEnd - inlineStart;
      inlineSize = outerInlineSize - area.getInsetStart() - area.getInsetEnd();
      if (!force && (blockSize <= 0 || inlineSize <= 0)) {
        return null;
      }
    } else {
      blockSize = area.computedBlockSize;
      outerBlockSize = blockSize + area.getInsetBefore() + area.getInsetAfter();
      const availableBlockSize = (blockEnd - blockStart) * area.getBoxDir();
      if (logicalFloatSide === 'snap-block') {
        if (anchorEdge === null) {
          // Deferred from previous container
          logicalFloatSide = 'block-start';
        } else {
          const containerRect = this.container.getPaddingRect();
          const fromStart = this.container.getBoxDir() *
              (anchorEdge -
               (this.container.vertical ? containerRect.x2 : containerRect.y1));
          const fromEnd = this.container.getBoxDir() *
              ((this.container.vertical ? containerRect.x1 : containerRect.y2) -
               anchorEdge - outerBlockSize);
          if (fromStart <= fromEnd) {
            logicalFloatSide = 'block-start';
          } else {
            logicalFloatSide = 'block-end';
          }
        }
        if (!condition[logicalFloatSide]) {
          if (condition['block-end']) {
            logicalFloatSide = 'block-end';
          } else {
            return null;
          }
        }
      }
      if (!force && availableBlockSize < outerBlockSize) {
        return null;
      }
      if (logicalFloatSide === 'inline-start' ||
          logicalFloatSide === 'inline-end') {
        inlineSize =
            getSize(area.clientLayout, area.element, [
              Size.FIT_CONTENT_INLINE_SIZE
            ])[Size.FIT_CONTENT_INLINE_SIZE];
      } else {
        if (area.adjustContentRelativeSize) {
          inlineSize = area.getContentInlineSize();
        } else {
          inlineSize = area.vertical ? area.height : area.width;
        }
      }
      outerInlineSize = inlineSize + area.getInsetStart() + area.getInsetEnd();
      const availableInlineSize = inlineEnd - inlineStart;
      if (!force && availableInlineSize < outerInlineSize) {
        return null;
      }
    }
    blockStart -= blockOffset;
    blockEnd -= blockOffset;
    inlineStart -= inlineOffset;
    inlineEnd -= inlineOffset;
    switch (logicalFloatSide) {
      case 'inline-start':
      case 'block-start':
      case 'snap-block':
        area.setInlinePosition(inlineStart, inlineSize);
        area.setBlockPosition(blockStart, blockSize);
        break;
      case 'inline-end':
      case 'block-end':
        area.setInlinePosition(inlineEnd - outerInlineSize, inlineSize);
        area.setBlockPosition(
            blockEnd - outerBlockSize * area.getBoxDir(), blockSize);
        break;
      default:
        throw new Error(`unknown float direction: ${floatSide}`);
    }
    return logicalFloatSide;
  }

  getFloatFragmentExclusions(): geom.Shape[] {
    const result =
        this.floatFragments.map((fragment) => fragment.getOuterShape());
    if (this.parent) {
      return this.parent.getFloatFragmentExclusions().concat(result);
    } else {
      return result;
    }
  }

  private reattachFloatFragments() {
    const parent = this.container.element && this.container.element.parentNode;
    if (parent) {
      this.floatFragments.forEach((fragment) => {
        parent.appendChild(fragment.area.element);
      });
    }
  }

  getMaxReachedAfterEdge(): number {
    const isVertical = this.getContainer().vertical;
    return this.floatFragments.reduce((edge, fragment) => {
      const rect = fragment.getOuterRect();
      if (isVertical) {
        return Math.min(edge, rect.x1);
      } else {
        return Math.max(edge, rect.y2);
      }
    }, isVertical ? Infinity : 0);
  }

  getBlockStartEdgeOfBlockEndFloats(): number {
    const isVertical = this.getContainer().vertical;
    return this.floatFragments
        .filter((fragment) => fragment.floatSide === 'block-end')
        .reduce((edge, fragment) => {
          const rect = fragment.getOuterRect();
          if (isVertical) {
            return Math.max(edge, rect.x2);
          } else {
            return Math.min(edge, rect.y1);
          }
        }, isVertical ? 0 : Infinity);
  }

  getPageFloatClearEdge(clear: string, column: Column): number {
    function isContinuationOfAlreadyAppearedFloat(context) {
      return (continuation) =>
                 context.isAnchorAlreadyAppeared(continuation.float.getId());
    }

    function isFragmentWithAlreadyAppearedFloat(fragment, context) {
      return fragment.continuations.some(
          isContinuationOfAlreadyAppearedFloat(context));
    }
    const columnRect = column.getPaddingRect();
    const columnBlockEnd = column.vertical ? columnRect.x1 : columnRect.y2;
    let context = this;
    while (context) {
      if (context.floatsDeferredToNext.some(
              isContinuationOfAlreadyAppearedFloat(context))) {
        return columnBlockEnd;
      }
      context = context.parent;
    }
    asserts.assert(column.clientLayout);
    const blockStartLimit = this.getLimitValue(
        'block-start', column.layoutContext, column.clientLayout,
        isFragmentWithAlreadyAppearedFloat);
    const blockEndLimit = this.getLimitValue(
        'block-end', column.layoutContext, column.clientLayout,
        isFragmentWithAlreadyAppearedFloat);
    if (blockEndLimit * column.getBoxDir() <
        columnBlockEnd * column.getBoxDir()) {
      return columnBlockEnd;
    } else {
      return blockStartLimit;
    }
  }

  getPageFloatPlacementCondition(
      float: PageFloat, floatSide: string,
      clearSide: string|null): PageFloatPlacementCondition {
    if (float.floatReference !== this.floatReference) {
      const parent = this.getParent(float.floatReference);
      return parent.getPageFloatPlacementCondition(float, floatSide, clearSide);
    }
    const result: PageFloatPlacementCondition = {
      'block-start': true,
      'block-end': true,
      'inline-start': true,
      'inline-end': true
    };
    if (!clearSide) {
      return result;
    }
    const logicalFloatSide = this.toLogical(floatSide);
    const logicalClearSide = this.toLogical(clearSide);
    let logicalSides: string[];
    if (logicalClearSide === 'all') {
      logicalSides = ['block-start', 'block-end', 'inline-start', 'inline-end'];
    } else {
      if (logicalClearSide === 'both') {
        logicalSides = ['inline-start', 'inline-end'];
      } else {
        if (logicalClearSide === 'same') {
          if (logicalFloatSide === 'snap-block') {
            logicalSides = ['block-start', 'block-end'];
          } else {
            logicalSides = [logicalFloatSide];
          }
        } else {
          logicalSides = [logicalClearSide];
        }
      }
    }
    const floatOrder = float.getOrder();

    function isPrecedingFragment(side: string): (p1: PageFloatFragment) =>
        boolean {
      return (fragment) => fragment.floatSide === side &&
          fragment.getOrder() < floatOrder;
    }

    function hasPrecedingFragmentInChildren(
        context: PageFloatLayoutContext, side: string): boolean {
      return context.children.some(
          (child) => child.floatFragments.some(isPrecedingFragment(side)) ||
              hasPrecedingFragmentInChildren(child, side));
    }

    function hasPrecedingFragmentInParents(
        context: PageFloatLayoutContext, side: string): boolean {
      const parent = context.parent;
      return !!parent &&
          (parent.floatFragments.some(isPrecedingFragment(side)) ||
           hasPrecedingFragmentInParents(parent, side));
    }
    logicalSides.forEach(function(side) {
      switch (side) {
        case 'block-start':
        case 'inline-start':
          result[side] = !hasPrecedingFragmentInChildren(this, side);
          break;
        case 'block-end':
        case 'inline-end':
          result[side] = !hasPrecedingFragmentInParents(this, side);
          break;
        default:
          throw new Error(`Unexpected side: ${side}`);
      }
    }, this);
    return result;
  }

  getLayoutConstraints(): LayoutConstraint[] {
    const constraints = this.parent ? this.parent.getLayoutConstraints() : [];
    return constraints.concat(this.layoutConstraints);
  }

  addLayoutConstraint(
      layoutConstraint: LayoutConstraint, floatReference: FloatReference) {
    if (floatReference === this.floatReference) {
      this.layoutConstraints.push(layoutConstraint);
    } else {
      this.getParent(floatReference)
          .addLayoutConstraint(layoutConstraint, floatReference);
    }
  }

  isColumnFullWithPageFloats(column: Column): boolean {
    const layoutContext = column.layoutContext;
    const clientLayout = column.clientLayout;
    asserts.assert(clientLayout);
    let context = this;
    let limits = null;
    while (context && context.container) {
      const l = context.getLimitValuesInner(layoutContext, clientLayout);
      if (limits) {
        if (column.vertical) {
          if (l.right < limits.right) {
            limits.right = l.right;
            limits.floatMinWrapBlockStart = l.floatMinWrapBlockStart;
          }
          if (l.left > limits.left) {
            limits.left = l.left;
            limits.floatMinWrapBlockEnd = l.floatMinWrapBlockEnd;
          }
        } else {
          if (l.top > limits.top) {
            limits.top = l.top;
            limits.floatMinWrapBlockStart = l.floatMinWrapBlockStart;
          }
          if (l.bottom < limits.bottom) {
            limits.bottom = l.bottom;
            limits.floatMinWrapBlockEnd = l.floatMinWrapBlockEnd;
          }
        }
      } else {
        limits = l;
      }
      context = context.parent;
    }
    const floatMinWrapBlock =
        Math.max(limits.floatMinWrapBlockStart, limits.floatMinWrapBlockEnd);
    const blockSpace = column.vertical ? limits.right - limits.left :
                                         limits.bottom - limits.top;
    return blockSpace <= floatMinWrapBlock;
  }

  getMaxBlockSizeOfPageFloats(): number {
    const isVertical = this.getContainer().vertical;
    if (!this.floatFragments.length) {
      return 0;
    }
    return Math.max.apply(null, this.floatFragments.map((fragment) => {
      const area = fragment.area;
      if (isVertical) {
        return area.width;
      } else {
        return area.height;
      }
    }));
  }

  lock() {
    this.locked = true;
  }

  unlock() {
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked;
  }
}
const PageFloatLayoutContext = PageFloatLayoutContext;

export interface PageFloatLayoutStrategy {
  appliesToNodeContext(nodeContext: vtree.NodeContext): boolean;

  appliesToFloat(float: PageFloat): boolean;

  createPageFloat(
      nodeContext: vtree.NodeContext,
      pageFloatLayoutContext: PageFloatLayoutContext,
      column: Column): task.Result<PageFloat>;

  createPageFloatFragment(
      continuations: PageFloatContinuation[], logicalFloatSide: string,
      floatArea: PageFloatArea, continues: boolean): PageFloatFragment;

  findPageFloatFragment(
      float: PageFloat,
      pageFloatLayoutContext: PageFloatLayoutContext): PageFloatFragment|null;

  adjustPageFloatArea(
      floatArea: PageFloatArea, floatContainer: vtree.Container,
      column: Column);

  forbid(float: PageFloat, pageFloatLayoutContext: PageFloatLayoutContext);
}
const PageFloatLayoutStrategy = PageFloatLayoutStrategy;
const pageFloatLayoutStrategies: PageFloatLayoutStrategy[] = [];

export class PageFloatLayoutStrategyResolver {
  static register(strategy: PageFloatLayoutStrategy) {
    pageFloatLayoutStrategies.push(strategy);
  }

  findByNodeContext(nodeContext: vtree.NodeContext): PageFloatLayoutStrategy {
    for (let i = pageFloatLayoutStrategies.length - 1; i >= 0; i--) {
      const strategy = pageFloatLayoutStrategies[i];
      if (strategy.appliesToNodeContext(nodeContext)) {
        return strategy;
      }
    }
    throw new Error(`No PageFloatLayoutStrategy found for ${nodeContext}`);
  }

  findByFloat(float: PageFloat): PageFloatLayoutStrategy {
    for (let i = pageFloatLayoutStrategies.length - 1; i >= 0; i--) {
      const strategy = pageFloatLayoutStrategies[i];
      if (strategy.appliesToFloat(float)) {
        return strategy;
      }
    }
    throw new Error(`No PageFloatLayoutStrategy found for ${float}`);
  }
}
const PageFloatLayoutStrategyResolver = PageFloatLayoutStrategyResolver;

export class NormalPageFloatLayoutStrategy implements PageFloatLayoutStrategy {
  /**
   * @override
   */
  appliesToNodeContext(nodeContext) isPageFloat(nodeContext.floatReference)

  /**
   * @override
   */
  appliesToFloat(float) true

  /**
   * @override
   */
  createPageFloat(nodeContext, pageFloatLayoutContext, column) {
    let floatReference = nodeContext.floatReference;
    asserts.assert(nodeContext.floatSide);
    const floatSide: string = nodeContext.floatSide;
    const nodePosition = nodeContext.toNodePosition();
    return column
        .resolveFloatReferenceFromColumnSpan(
            floatReference, nodeContext.columnSpan, nodeContext)
        .thenAsync((ref) => {
          floatReference = ref;
          asserts.assert(pageFloatLayoutContext.flowName);
          const float = new PageFloat(
              nodePosition, floatReference, floatSide, nodeContext.clearSide,
              pageFloatLayoutContext.flowName, nodeContext.floatMinWrapBlock);
          pageFloatLayoutContext.addPageFloat(float);
          return task.newResult(float);
        });
  }

  /**
   * @override
   */
  createPageFloatFragment(continuations, floatSide, floatArea, continues) {
    const f = continuations[0].float;
    return new PageFloatFragment(
        f.floatReference, floatSide, continuations, floatArea, continues);
  }

  /**
   * @override
   */
  findPageFloatFragment(float, pageFloatLayoutContext)
      pageFloatLayoutContext.findPageFloatFragment(float)

  /**
   * @override
   */
  adjustPageFloatArea(floatArea, floatContainer, column) {}

  /**
   * @override
   */
  forbid(float, pageFloatLayoutContext) {}
}
const NormalPageFloatLayoutStrategy = NormalPageFloatLayoutStrategy;
PageFloatLayoutStrategyResolver.register(new NormalPageFloatLayoutStrategy());
