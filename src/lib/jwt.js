import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

const MASTER_ADMIN_ROLE = "master_admin";
const STUDENT_ROLE = "student";
const FACULTY_ROLE = "faculty";

export function signMasterAdminToken({ sub, email, name }) {
  return jwt.sign(
    {
      role: MASTER_ADMIN_ROLE,
      email,
      name,
    },
    env.jwtSecret,
    {
      subject: sub,
      expiresIn: env.jwtExpiresIn,
    }
  );
}

export function verifyMasterAdminToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (decoded.role !== MASTER_ADMIN_ROLE) {
    const err = new Error("Invalid token role");
    err.statusCode = 403;
    throw err;
  }
  return decoded;
}

export function signStudentToken({ sub, email, name, phone }) {
  return jwt.sign(
    {
      role: STUDENT_ROLE,
      email,
      name,
      phone: phone || null,
    },
    env.jwtSecret,
    {
      subject: sub,
      expiresIn: env.jwtExpiresIn,
    }
  );
}

export function verifyStudentToken(token) {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (decoded.role !== STUDENT_ROLE) {
    const err = new Error("Invalid token role");
    err.statusCode = 403;
    throw err;
  }
  return decoded;
}

export function signFacultyToken({ sub, email, name }) {
  return jwt.sign(
    {
      role: FACULTY_ROLE,
      email,
      name,
    },
    env.jwtSecret,
    {
      subject: sub,
      expiresIn: env.jwtExpiresIn,
    }
  );
}

export { MASTER_ADMIN_ROLE, STUDENT_ROLE, FACULTY_ROLE };
