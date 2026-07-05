// GET /api/users/[id]/profile-pdf
// 流式返回员工档案 PDF(HR 入职材料包)
//
// 权限: 与 with-profile 一致(READ 权限),额外校验:
//   - actor.roleCode === "ADMIN",或
//   - actor.id === userId(导出自己的档案)
//
// 数据组装:复用 getUserFullProfile 的输出,加 avatarUrl(从 avatarAttachmentId
// 拼出 /api/files/raw/{id} URL,react-pdf 渲染时再 fetch)。

import { NextResponse } from "next/server";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { renderToBuffer } from "@react-pdf/renderer";
import { getUserFullProfile } from "@/server/services/employee-profile";
import { EmployeeProfilePdf } from "@/server/templates/employee-profile-pdf";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;

      if (actor.roleCode !== "ADMIN" && actor.id !== id) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员或本人可导出档案 PDF", 403);
      }

      const full = await getUserFullProfile(actor, id);
      if (!full) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "员工档案不存在", 404);
      }

      // 头像 URL:从 avatarAttachmentId 拼相对路径,react-pdf 在 Node 端 fetch
      const avatarUrl = full.profile.avatarAttachmentId
        ? `/api/files/raw/${full.profile.avatarAttachmentId}`
        : null;

      // 找用户姓名/工号(直接从 user 表)
      const userRow = await prisma.user.findFirst({
        where: { id, deletedAt: null },
        select: { name: true, employeeNo: true }
      });
      if (!userRow) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
      }

      const buf = await renderToBuffer(
        EmployeeProfilePdf({
          data: {
            user: { name: userRow.name, employeeNo: userRow.employeeNo },
            profile: {
              gender: full.profile.gender,
              birthday: full.profile.birthday,
              idCard: full.profile.idCard,
              education: full.profile.education,
              entryDate: full.profile.entryDate,
              position: full.profile.position,
              jobLevel: full.profile.jobLevel,
              employmentType: full.profile.employmentType,
              probationEndDate: full.profile.probationEndDate,
              formalDate: full.profile.formalDate,
              resignationDate: full.profile.resignationDate,
              contractType: full.profile.contractType,
              contractStartDate: full.profile.contractStartDate,
              contractEndDate: full.profile.contractEndDate,
              province: full.profile.province,
              city: full.profile.city,
              district: full.profile.district,
              addressDetail: full.profile.addressDetail,
              remark: full.profile.remark
            },
            educations: full.educations.map((e) => ({
              school: e.school,
              major: e.major,
              degree: e.degree,
              startDate: e.startDate,
              endDate: e.endDate
            })),
            workExperiences: full.workExperiences.map((w) => ({
              company: w.company,
              position: w.position,
              startDate: w.startDate,
              endDate: w.endDate,
              leaveReason: w.leaveReason
            })),
            certificates: full.certificates.map((c) => ({
              name: c.name,
              number: c.number,
              issuer: c.issuer,
              issueDate: c.issueDate,
              expiryDate: c.expiryDate
            })),
            skills: full.skills.map((sk) => ({
              name: sk.name,
              level: sk.level,
              obtainDate: sk.obtainDate
            })),
            emergencyContacts: full.emergencyContacts.map((c) => ({
              name: c.name,
              relationship: c.relationship,
              phone: c.phone
            })),
            avatarUrl,
            generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
            docVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.9"
          }
        })
      );

      // 浏览器端 inline 预览 + 文件名下载
      const filename = encodeURIComponent(`${userRow.name}-员工档案.pdf`);
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Content-Length": String(buf.length),
          "Cache-Control": "private, no-store"
        }
      });
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json(
          { code: e.status, message: e.message, errorCode: e.errorCode },
          { status: e.status }
        );
      }
      // 兜底:任何 renderToBuffer 错误也走 JSON 响应(不直接抛 500 HTML)
      const msg = e instanceof Error ? e.message : "PDF 生成失败";
      return NextResponse.json(
        { code: -1, message: msg, errorCode: "PDF_RENDER_ERROR" },
        { status: 500 }
      );
    }
  });
}
