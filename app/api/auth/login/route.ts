import { z } from "zod";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const schema = z.object({
  employeeNo: z.string().min(1),
  password: z.string().min(1)
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { employeeNo, password } = schema.parse(body);
    const user = await prisma.user.findFirst({
      where: { employeeNo, deletedAt: null, status: "ACTIVE" },
      include: { role: true }
    });
    if (!user) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "账号或密码错误", 401);
    const okPw = await bcrypt.compare(password, user.passwordHash);
    if (!okPw) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "账号或密码错误", 401);
    // 触发 next-auth 的 csrf + callback 拿 session cookie
    // 返回 csrfToken 给客户端，让前端用 signIn("credentials", ...) 完成会话建立
    // 这里只做凭证校验，session 建立交给前端 signIn
    return ok({
      id: user.id,
      employeeNo: user.employeeNo,
      name: user.name,
      email: user.email,
      roleCode: user.role.code
    });
  } catch (e) {
    return err(e);
  }
}
