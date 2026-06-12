// Workflow Engine 输入校验(P1: 实例化 / 任务流转 / 任务分配 / 二审)
import { z } from "zod";
import {
  WORKFLOW_TASK_ACTIONS,
  WORKFLOW_REVIEW_ACTIONS
} from "@/types/enums";

export const workflowTaskActionSchema = z.object({
  action: z.enum(WORKFLOW_TASK_ACTIONS),
  remark: z.string().max(2000).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string().optional(),
        mimeType: z.string(),
        size: z.number().int().nonnegative()
      })
    )
    .optional()
});

export type WorkflowTaskActionInput = z.infer<typeof workflowTaskActionSchema>;

export const workflowTaskAssignSchema = z.object({
  assigneeId: z.string().min(1).nullable()
});

export const workflowTaskReviewSchema = z.object({
  action: z.enum(WORKFLOW_REVIEW_ACTIONS),
  comment: z.string().max(1000).optional()
});

export const workflowTaskUpdateRemarkSchema = z.object({
  remark: z.string().max(2000).optional(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        url: z.string().optional(),
        mimeType: z.string(),
        size: z.number().int().nonnegative()
      })
    )
    .optional()
});
