// 子表 DTO。Date → ISO 字符串,删 deletedAt。详情页读取时统一用。
// 跟 EmployeeProfileDto 模式一致(见 lib/types/employee-profile.ts)。

export type EmployeeEducationDto = {
  id: string;
  profileId: string;
  school: string;
  major: string | null;
  degree: string | null;
  startDate: string;
  endDate: string | null;
  isFullTime: boolean;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeWorkExperienceDto = {
  id: string;
  profileId: string;
  company: string;
  position: string | null;
  startDate: string;
  endDate: string | null;
  leaveReason: string | null;
  referrer: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeCertificateDto = {
  id: string;
  profileId: string;
  name: string;
  number: string | null;
  issuer: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  attachmentId: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeSkillDto = {
  id: string;
  profileId: string;
  name: string;
  level: string;
  obtainDate: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeEmergencyContactDto = {
  id: string;
  profileId: string;
  name: string;
  relationship: string;
  phone: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};
