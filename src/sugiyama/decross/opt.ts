/**
 * Create a decrossing operator that minimizes the the number of edge
 * crossings. This method solves an np-complete integer program, and as such
 * can take a very long time for large DAGs.
 *
 * Create a new [[OptOperator]] with [[opt]].
 *
 * <img alt="optimal decross example" src="media://simplex.png" width="400">
 *
 * @module
 */
import { Model, Solve } from "javascript-lp-solver";

import { DagNode } from "../../dag/node";
import { DummyNode } from "../dummy";
import { Operator } from ".";
import { def } from "../../utils";

export interface OptOperator<NodeType extends DagNode>
  extends Operator<NodeType> {
  /**
   * Set the clowntown value, which when true will allow opt to run on inputs
   * that will either crash or never complete.
   */
  clowntown(val: boolean): OptOperator<NodeType>;
  /** Get the current clowntown value. */
  clowntown(): boolean;
}

/** @internal */
function buildOperator<NodeType extends DagNode>(options: {
  clowntown: boolean;
}): OptOperator<NodeType> {
  // TODO optimize this for disconnected graphs by breaking them apart, solving
  // each, then mushing them back together

  function optCall(layers: (NodeType | DummyNode)[][]): void {
    // check for large input
    if (
      !options.clowntown &&
      layers.reduce((t, l) => t + l.length * l.length, 0) > 2500
    ) {
      throw new Error(
        "size of dag to decrossOpt is too large and will likely crash not complete, enable clowntown to run anyway"
      );
    }

    // initialize model
    const model: Model = {
      optimize: "opt",
      opType: "min",
      constraints: Object.create(null),
      variables: Object.create(null),
      ints: Object.create(null)
    };

    // initialize map to create "ids"
    const ids = new Map<NodeType | DummyNode, string>();
    for (const [i, layer] of layers.entries()) {
      for (const [j, node] of layer.entries()) {
        ids.set(node, `(${i} ${j})`);
      }
    }

    /** create a key from nodes */
    function key(...nodes: (NodeType | DummyNode)[]): string {
      return nodes
        .map((n) => def(ids.get(n)))
        .sort()
        .join(" => ");
    }

    /** compare nodes by id */
    function comp(n1: NodeType | DummyNode, n2: NodeType | DummyNode): number {
      return def(ids.get(n1)).localeCompare(def(ids.get(n2)));
    }

    function perms(model: Model, layer: (NodeType | DummyNode)[]): void {
      layer.sort(comp);

      // add variables for each pair of bottom later nodes indicating if they
      // should be flipped
      for (const [i, n1] of layer.slice(0, layer.length - 1).entries()) {
        for (const n2 of layer.slice(i + 1)) {
          const pair = key(n1, n2);
          model.ints[pair] = 1;
          model.constraints[pair] = Object.assign(Object.create(null), {
            max: 1
          });
          model.variables[pair] = Object.assign(Object.create(null), {
            opt: 0,
            [pair]: 1
          });
        }
      }

      // add constraints to enforce triangle inequality, e.g. that if a -> b is 1
      // and b -> c is 1 then a -> c must also be one
      for (const [i, n1] of layer.slice(0, layer.length - 1).entries()) {
        for (const [j, n2] of layer.slice(i + 1).entries()) {
          for (const n3 of layer.slice(i + j + 2)) {
            const pair1 = key(n1, n2);
            const pair2 = key(n1, n3);
            const pair3 = key(n2, n3);
            const triangle = key(n1, n2, n3);

            const triangleUp = triangle + "+";
            model.constraints[triangleUp] = Object.assign(Object.create(null), {
              max: 1
            });
            model.variables[pair1][triangleUp] = 1;
            model.variables[pair2][triangleUp] = -1;
            model.variables[pair3][triangleUp] = 1;

            const triangleDown = triangle + "-";
            model.constraints[triangleDown] = Object.assign(
              Object.create(null),
              {
                min: 0
              }
            );
            model.variables[pair1][triangleDown] = 1;
            model.variables[pair2][triangleDown] = -1;
            model.variables[pair3][triangleDown] = 1;
          }
        }
      }
    }

    function cross(model: Model, layer: (NodeType | DummyNode)[]): void {
      for (const [i, p1] of layer.slice(0, layer.length - 1).entries()) {
        for (const p2 of layer.slice(i + 1)) {
          const pairp = key(p1, p2);
          for (const c1 of p1.ichildren()) {
            for (const c2 of p2.ichildren()) {
              if (c1 === c2) {
                continue;
              }
              const pairc = key(c1, c2);
              const slack = `slack (${pairp}) (${pairc})`;
              const slackUp = `${slack} +`;
              const slackDown = `${slack} -`;
              model.variables[slack] = Object.assign(Object.create(null), {
                opt: 1,
                [slackUp]: 1,
                [slackDown]: 1
              });

              const sign = comp(c1, c2);
              const flip = Math.max(sign, 0);

              model.constraints[slackUp] = Object.assign(Object.create(null), {
                min: flip
              });
              model.variables[pairp][slackUp] = 1;
              model.variables[pairc][slackUp] = sign;

              model.constraints[slackDown] = Object.assign(
                Object.create(null),
                {
                  min: -flip
                }
              );
              model.variables[pairp][slackDown] = -1;
              model.variables[pairc][slackDown] = -sign;
            }
          }
        }
      }
    }

    // add variables and permutation invariants
    for (const layer of layers) {
      perms(model, layer);
    }

    // add crossing minimization
    for (const layer of layers.slice(0, layers.length - 1)) {
      cross(model, layer);
    }

    // solve objective
    const ordering = Solve(model);

    // sort layers
    for (const layer of layers) {
      layer.sort(
        /* istanbul ignore next */
        (n1, n2) => comp(n1, n2) * (ordering[key(n1, n2)] || -1)
      );
    }
  }

  function clowntown(): boolean;
  function clowntown(val: boolean): OptOperator<NodeType>;
  function clowntown(val?: boolean): boolean | OptOperator<NodeType> {
    if (val === undefined) {
      return options.clowntown;
    } else {
      return buildOperator({ ...options, clowntown: val });
    }
  }
  optCall.clowntown = clowntown;

  return optCall;
}

/** Create a default [[OptOperator]]. */
export function opt<NodeType extends DagNode>(
  ...args: never[]
): OptOperator<NodeType> {
  if (args.length) {
    throw new Error(
      `got arguments to opt(${args}), but constructor takes no aruguments.`
    );
  }
  return buildOperator({ clowntown: false });
}
