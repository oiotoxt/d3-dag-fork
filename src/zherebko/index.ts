/**
 * A topological layout using {@link ZherebkoOperator}.
 *
 * @packageDocumentation
 */
import { Dag } from "../dag";
import { entries } from "../iters";
import { greedy } from "./greedy";

/**
 * The return from calling {@link ZherebkoOperator}
 *
 * This is the final width and height of the laid out dag.
 */
export interface ZherebkoInfo {
  /** total width after layout */
  width: number;
  /** total height after layout */
  height: number;
}

/**
 * A simple topological layout operator.
 *
 * This layout algorithm constructs a topological representation of the dag
 * meant for visualization. The algorithm is based off a PR by D. Zherebko. The
 * nodes are topologically ordered, and edges are then positioned into "lanes"
 * to the left and right of the nodes.
 *
 * Create with {@link zherebko}.
 *
 * @example
 * <img alt="zherebko example" src="media://zherebko.png" width="1000">
 *
 * @example
 * ```typescript
 * const data = [["parent", "child"], ...];
 * const create = connect();
 * const dag = create(data);
 * const layout = zherebko();
 * const { width, height } = layout(dag);
 * for (const node of dag) {
 *   console.log(node.x, node.y);
 * }
 * ```
 */
export interface ZherebkoOperator {
  /** Layout the input dag */
  (dag: Dag): ZherebkoInfo;

  /**
   * Set the zherebko layout's node size
   *
   * Set the size to the specified three-element array of numbers [
   * *nodeWidth*, *nodeHeight*, *edgeGap* ] and returns a new operator. Nodes
   * are spaced apart vertically by nodeHeight, and each node is given space of
   * nodeWidth. Edges that wrap around the nodes are given space edgeGap.
   *
   * (default: [1, 1, 1])
   */
  nodeSize(val: readonly [number, number, number]): ZherebkoOperator;
  /** Get the current node size. */
  nodeSize(): [number, number, number];

  /**
   * Set the zherebko layouts full size
   *
   * Set the size to the specified two-element array of numbers [ *width*,
   * *height* ] and returns a new operator. The dag is resized to fit within
   * width and height if they are specified. (default: null)
   */
  size(val: null | readonly [number, number]): ZherebkoOperator;
  /** Get the current size */
  size(): null | [number, number];
}

/** @internal */
function buildOperator(
  nodeWidth: number,
  nodeHeight: number,
  edgeGap: number,
  sizeVal: null | readonly [number, number]
): ZherebkoOperator {
  function zherebkoCall(dag: Dag): ZherebkoInfo {
    // topological sort
    const levels = [];
    let numLevels = 0;
    let last;
    for (const node of dag.idescendants("before")) {
      if (last !== undefined && last.nchildLinksTo(node) > 1) {
        ++numLevels;
      }
      levels.push([node, numLevels++] as const);
      last = node;
    }

    // get link indices
    const indices = greedy(levels);

    // map to coordinates
    let minIndex = 0;
    let maxIndex = 0;
    for (const inds of indices.values()) {
      for (const ind of inds) {
        if (ind !== undefined) {
          minIndex = Math.min(minIndex, ind);
          maxIndex = Math.max(maxIndex, ind);
        }
      }
    }

    // assign node positions
    const nodex = -minIndex * edgeGap + nodeWidth / 2;
    for (const [node, layer] of levels) {
      node.x = nodex;
      node.y = (layer + 0.5) * nodeHeight;
    }

    // assign link points
    for (const source of dag) {
      const inds = indices.get(source) ?? [];
      // we iterate like this instead of ilinks to get the indices among
      // children as a way to dedup links
      for (const [index, { target, points }] of entries(source.ichildLinks())) {
        points.length = 0;
        points.push({ x: source.x!, y: source.y! });
        const ind = inds[index];

        if (ind !== undefined) {
          // assumed long link
          const x =
            (ind - minIndex + 0.5) * edgeGap +
            (ind > 0 ? nodeWidth - edgeGap : 0);
          const y1 = source.y! + nodeHeight;
          const y2 = target.y! - nodeHeight;
          if (y2 - y1 > nodeHeight / 2) {
            points.push({ x: x, y: y1 }, { x: x, y: y2 });
          } else {
            points.push({ x: x, y: y1 });
          }
        }

        points.push({ x: target.x!, y: target.y! });
      }
    }

    const width = (maxIndex - minIndex) * edgeGap + nodeWidth;
    const height = numLevels * nodeHeight;
    if (sizeVal === null) {
      return { width, height };
    } else {
      // rescale to new size
      const [newWidth, newHeight] = sizeVal;
      for (const [node] of levels) {
        node.x! *= newWidth / width;
        node.y! *= newHeight / height;
      }
      for (const { points } of dag.ilinks()) {
        const newPoints = points.map(({ x, y }) => ({
          x: (x! * newWidth) / width,
          y: (y! * newHeight) / height,
        }));
        points.splice(0, points.length, ...newPoints);
      }
      return { width: newWidth, height: newHeight };
    }
  }

  function nodeSize(): [number, number, number];
  function nodeSize(val: readonly [number, number, number]): ZherebkoOperator;
  function nodeSize(
    val?: readonly [number, number, number]
  ): [number, number, number] | ZherebkoOperator {
    if (val === undefined) {
      return [nodeWidth, nodeHeight, edgeGap];
    } else {
      const [newWidth, newHeight, newGap] = val;
      return buildOperator(newWidth, newHeight, newGap, sizeVal);
    }
  }
  zherebkoCall.nodeSize = nodeSize;

  function size(): [number, number];
  function size(val: null | readonly [number, number]): ZherebkoOperator;
  function size(
    val?: null | readonly [number, number]
  ): null | [number, number] | ZherebkoOperator {
    if (val !== undefined) {
      return buildOperator(nodeWidth, nodeHeight, edgeGap, val);
    } else if (sizeVal === null) {
      return sizeVal;
    } else {
      const [width, height] = sizeVal;
      return [width, height];
    }
  }
  zherebkoCall.size = size;

  return zherebkoCall;
}

/**
 * Create a new {@link ZherebkoOperator} with default settings.
 */
export function zherebko(...args: never[]): ZherebkoOperator {
  if (args.length) {
    throw new Error(
      `got arguments to zherebko(${args}), but constructor takes no arguments.`
    );
  }
  return buildOperator(1, 1, 1, null);
}
