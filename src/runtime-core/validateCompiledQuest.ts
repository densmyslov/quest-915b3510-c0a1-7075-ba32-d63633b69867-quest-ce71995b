import {
  NODE_ID_RE,
  OBJECT_ID_RE,
  type ActionNode,
  type CompiledQuestDefinition,
  type NodeId,
  type ObjectId,
  type PuzzleNode,
  type TimelineNode,
} from './compiledQuest';

export type CompiledQuestValidationError = {
  path: string;
  message: string;
};

function push(errors: CompiledQuestValidationError[], path: string, message: string) {
  errors.push({ path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateObjectId(errors: CompiledQuestValidationError[], path: string, value: unknown): value is ObjectId {
  if (!isNonEmptyString(value)) {
    push(errors, path, 'expected non-empty string');
    return false;
  }
  if (!OBJECT_ID_RE.test(value)) {
    push(errors, path, `invalid objectId format: ${value}`);
    return false;
  }
  return true;
}

function validateNodeId(errors: CompiledQuestValidationError[], path: string, value: unknown): value is NodeId {
  if (!isNonEmptyString(value)) {
    push(errors, path, 'expected non-empty string');
    return false;
  }
  if (!NODE_ID_RE.test(value)) {
    push(errors, path, `invalid nodeId format: ${value}`);
    return false;
  }
  return true;
}

function getOutgoingNodeIds(node: TimelineNode): NodeId[] {
  if (node.type === 'puzzle' || node.type === 'action') {
    return [...node.successOutNodeIds, ...(node.failureOutNodeIds ?? [])];
  }
  return node.outNodeIds;
}

export function validateCompiledQuestDefinition(def: unknown): CompiledQuestValidationError[] {
  const errors: CompiledQuestValidationError[] = [];

  if (!isRecord(def)) {
    push(errors, '', 'expected object');
    return errors;
  }

  if (!isNonEmptyString(def.schemaVersion)) push(errors, 'schemaVersion', 'required string');
  if (!isNonEmptyString(def.questId)) push(errors, 'questId', 'required string');
  if (!isNonEmptyString(def.questVersion)) push(errors, 'questVersion', 'required string');
  if (!isNonEmptyString(def.publishedAt)) push(errors, 'publishedAt', 'required date-time string');

  if (!isRecord(def.policies)) push(errors, 'policies', 'required object');
  if (!isRecord(def.start) || !validateObjectId(errors, 'start.objectId', (def.start as any)?.objectId)) {
    // recorded by validateObjectId
  }
  if (!isRecord(def.end) || !validateObjectId(errors, 'end.objectId', (def.end as any)?.objectId)) {
    // recorded by validateObjectId
  }

  if (!isRecord(def.objects)) push(errors, 'objects', 'required object map');
  if (!isRecord(def.timelineNodes)) push(errors, 'timelineNodes', 'required object map');

  if (errors.length > 0) return errors;

  const typed = def as CompiledQuestDefinition;

  // Key format checks
  for (const objectId of Object.keys(typed.objects)) {
    validateObjectId(errors, `objects.${objectId}`, objectId);
  }
  for (const nodeId of Object.keys(typed.timelineNodes)) {
    validateNodeId(errors, `timelineNodes.${nodeId}`, nodeId);
  }

  const startObjectId = typed.start.objectId;
  const endObjectId = typed.end.objectId;
  if (!(startObjectId in typed.objects)) push(errors, 'start.objectId', `unknown objectId: ${startObjectId}`);
  if (!(endObjectId in typed.objects)) push(errors, 'end.objectId', `unknown objectId: ${endObjectId}`);

  // Object defs
  for (const [objectId, obj] of Object.entries(typed.objects)) {
    if (!isNonEmptyString(obj.title)) push(errors, `objects.${objectId}.title`, 'required string');
    if (!validateNodeId(errors, `objects.${objectId}.entryNodeId`, obj.entryNodeId)) continue;
    if (!(obj.entryNodeId in typed.timelineNodes)) {
      push(errors, `objects.${objectId}.entryNodeId`, `unknown nodeId: ${obj.entryNodeId}`);
    } else {
      const entryNode = typed.timelineNodes[obj.entryNodeId];
      if (entryNode.objectId !== objectId) {
        push(errors, `objects.${objectId}.entryNodeId`, `entryNodeId belongs to ${entryNode.objectId}`);
      }
      if (entryNode.type !== 'state' || (entryNode as any).stateKind !== 'start') {
        push(errors, `objects.${objectId}.entryNodeId`, 'entryNodeId must point to a state:start node');
      }
    }

    if (!Array.isArray(obj.outObjectIds)) {
      push(errors, `objects.${objectId}.outObjectIds`, 'expected array');
    } else {
      for (let idx = 0; idx < obj.outObjectIds.length; idx++) {
        const outId = obj.outObjectIds[idx];
        if (!validateObjectId(errors, `objects.${objectId}.outObjectIds[${idx}]`, outId)) continue;
        if (!(outId in typed.objects)) {
          push(errors, `objects.${objectId}.outObjectIds[${idx}]`, `unknown objectId: ${outId}`);
        }
      }
    }

    const expectedStart = `tl_${objectId}__start`;
    const expectedEnd = `tl_${objectId}__end`;
    if (!(expectedStart in typed.timelineNodes)) {
      push(errors, `timelineNodes.${expectedStart}`, 'missing required state:start node');
    }
    if (!(expectedEnd in typed.timelineNodes)) {
      push(errors, `timelineNodes.${expectedEnd}`, 'missing required state:end node');
    }
  }

  // Node defs
  for (const [nodeId, node] of Object.entries(typed.timelineNodes)) {
    if (!validateObjectId(errors, `timelineNodes.${nodeId}.objectId`, node.objectId)) continue;
    if (!(node.objectId in typed.objects)) {
      push(errors, `timelineNodes.${nodeId}.objectId`, `unknown objectId: ${node.objectId}`);
    }

    const adjacencyPath = `timelineNodes.${nodeId}`;

    if (node.type === 'puzzle' || node.type === 'action') {
      const branchingNode = node as PuzzleNode | ActionNode;
      if (!Array.isArray(branchingNode.successOutNodeIds) || branchingNode.successOutNodeIds.length < 1) {
        push(errors, `${adjacencyPath}.successOutNodeIds`, 'required array with at least 1 nodeId');
      } else {
        branchingNode.successOutNodeIds.forEach((out, idx) => {
          if (!validateNodeId(errors, `${adjacencyPath}.successOutNodeIds[${idx}]`, out)) return;
          if (!(out in typed.timelineNodes)) push(errors, `${adjacencyPath}.successOutNodeIds[${idx}]`, `unknown nodeId: ${out}`);
        });
      }

      if (branchingNode.failureOutNodeIds !== undefined) {
        if (!Array.isArray(branchingNode.failureOutNodeIds)) {
          push(errors, `${adjacencyPath}.failureOutNodeIds`, 'expected array');
        } else {
          branchingNode.failureOutNodeIds.forEach((out, idx) => {
            if (!validateNodeId(errors, `${adjacencyPath}.failureOutNodeIds[${idx}]`, out)) return;
            if (!(out in typed.timelineNodes)) push(errors, `${adjacencyPath}.failureOutNodeIds[${idx}]`, `unknown nodeId: ${out}`);
          });
        }
      }
    } else {
      if (!Array.isArray((node as any).outNodeIds)) {
        push(errors, `${adjacencyPath}.outNodeIds`, 'required array');
      } else {
        (node as any).outNodeIds.forEach((out: unknown, idx: number) => {
          if (!validateNodeId(errors, `${adjacencyPath}.outNodeIds[${idx}]`, out)) return;
          if (!(out in typed.timelineNodes)) push(errors, `${adjacencyPath}.outNodeIds[${idx}]`, `unknown nodeId: ${out}`);
        });
      }
    }

    // For end nodes, require outNodeIds to be empty (best-effort; engine can still ignore).
    if (node.type === 'state' && (node as any).stateKind === 'end') {
      const outs = getOutgoingNodeIds(node);
      if (outs.length !== 0) push(errors, `${adjacencyPath}.outNodeIds`, 'state:end must have no outgoing nodeIds');
    }
  }

  return errors;
}

export function assertValidCompiledQuestDefinition(def: unknown): asserts def is CompiledQuestDefinition {
  const errors = validateCompiledQuestDefinition(def);
  if (errors.length === 0) return;

  const formatted = errors.map((e) => (e.path ? `${e.path}: ${e.message}` : e.message)).join('\n');
  throw new Error(`Invalid compiled quest definition:\n${formatted}`);
}

