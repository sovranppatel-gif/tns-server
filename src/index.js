import http from "http";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import { env } from "./config/env.js";
import masterAdminAuthRoutes from "./routes/masterAdminAuth.routes.js";
import studentAuthRoutes from "./routes/studentAuth.routes.js";
import studentNotificationsRoutes from "./routes/studentNotifications.routes.js";
import studentDashboardRoutes from "./modules/students/studentDashboard.routes.js";
import studentLearningRoutes from "./modules/students/studentLearning.routes.js";
import studentSupportRoutes from "./modules/support/studentSupport.routes.js";
import enquiriesRoutes from "./modules/enquiries/enquiries.routes.js";
import leadsRoutes from "./modules/leads/leads.routes.js";
import siteSettingsRoutes from "./routes/siteSettings.routes.js";
import admissionsRoutes from "./routes/admissions.routes.js";
import aboutRoutes from "./modules/about/about.routes.js";
import expertiseRoutes from "./modules/expertise/expertise.routes.js";
import processRoutes from "./modules/process/process.routes.js";
import servicesRoutes from "./modules/services/services.routes.js";
import caseStudyRoutes from "./modules/caseStudy/caseStudy.routes.js";
import faqRoutes from "./modules/faq/faq.routes.js";
import heroLeftRoutes from "./modules/heroLeft/heroLeft.routes.js";
import universitiesRoutes from "./modules/universities/universities.routes.js";
import coursesRoutes from "./modules/courses/courses.routes.js";
import feesRoutes from "./modules/fees/fees.routes.js";
import studentFeesRoutes from "./modules/fees/studentFees.routes.js";
import attendanceRoutes from "./modules/attendance/attendance.routes.js";
import batchesRoutes from "./modules/batches/batches.routes.js";
import studentsRoutes from "./modules/students/students.routes.js";
import activityLogRoutes from "./modules/activityLog/activityLog.routes.js";
import dashboardRoutes from "./modules/dashboard/dashboard.routes.js";
import reportsRoutes from "./modules/reports/reports.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import backupRoutes from "./modules/backup/backup.routes.js";
import facultyRoutes from "./modules/faculty/faculty.routes.js";
import staffRoutes from "./modules/staff/staff.routes.js";
import {
  accountingRouter,
  advancesRouter,
  expensesRouter,
  financeRouter,
  incomeRouter,
  loansRouter,
  paymentsRouter,
  payrollRouter,
  salaryRouter,
} from "./modules/finance/finance.routes.js";
import questionBankRoutes from "./modules/exams/questionBank.routes.js";
import examsRoutes from "./modules/exams/exams.routes.js";
import studentExamsRoutes from "./modules/exams/studentExams.routes.js";
import assignmentsRoutes from "./modules/assignments/assignments.routes.js";
import { activityLogger } from "./middleware/activityLogger.js";
import { requireDbReady } from "./middleware/requireDbReady.js";
import { initSocket } from "./lib/socket.js";
import { connectMongoOnce } from "./db/connectMongo.js";
import { isVercel } from "./lib/isVercel.js";
import { normalizeVercelPath } from "./lib/normalizeVercelPath.js";
import { getUploadRoot } from "./lib/uploadRoot.js";
import { seedEnquiriesDemo } from "./db/seedEnquiriesDemo.js";
import { seedLeadsDemo } from "./db/seedLeadsDemo.js";
import { seedSiteSettingsDemo } from "./db/seedSiteSettingsDemo.js";
import { seedAboutDemo } from "./db/seedAboutDemo.js";
import { seedExpertiseDemo } from "./db/seedExpertiseDemo.js";
import { seedProcessDemo } from "./db/seedProcessDemo.js";
import { seedServicesDemo } from "./db/seedServicesDemo.js";
import { seedCaseStudyDemo } from "./db/seedCaseStudyDemo.js";
import { seedFaqDemo } from "./db/seedFaqDemo.js";
import { seedHeroLeftDemo } from "./db/seedHeroLeftDemo.js";
import { seedUniversitiesDemo } from "./db/seedUniversitiesDemo.js";
import { seedMasterAdminUser } from "./db/seedMasterAdminUser.js";
import { seedCoursesDemo } from "./db/seedCoursesDemo.js";
import { seedBatchesAndAttendance } from "./db/seedBatchesAndAttendance.js";
import { seedStaffDemo } from "./db/seedStaffDemo.js";
import { seedStaffLookups } from "./db/seedStaffLookups.js";

const app = express();

app.set("trust proxy", true);
app.use(normalizeVercelPath);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(activityLogger);

app.use("/uploads", express.static(getUploadRoot()));

function apiStatus(_req, res) {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(200).json({
    success: true,
    message: "TNS API is running",
    mongoReady,
    health: "/health",
  });
}

function healthStatus(_req, res) {
  const mongoReady = mongoose.connection.readyState === 1;
  res.status(mongoReady ? 200 : 503).json({
    ok: mongoReady,
    mongoReady,
    readyState: mongoose.connection.readyState,
  });
}

app.get("/", apiStatus);
app.get("/api", apiStatus);
app.get("/health", healthStatus);
app.get("/api/health", healthStatus);

// Fail fast on API while Mongo is reconnecting (avoids long hung logins)
app.use("/api", requireDbReady);

app.use("/api/master-admin/auth", masterAdminAuthRoutes);
app.use("/api/students/auth", studentAuthRoutes);
app.use("/api/students/notifications", studentNotificationsRoutes);
app.use("/api/students/fees", studentFeesRoutes);
app.use("/api/students/dashboard", studentDashboardRoutes);
app.use("/api/students/learning", studentLearningRoutes);
app.use("/api/students/support", studentSupportRoutes);
app.use("/api/students", studentsRoutes);
app.use("/api/enquiries", enquiriesRoutes);
// Legacy alias — same handlers as /api/enquiries
app.use("/api/community-join", enquiriesRoutes);
app.use("/api/leads", leadsRoutes);
app.use("/api/site-settings", siteSettingsRoutes);
app.use("/api/admissions", admissionsRoutes);
app.use("/api/about", aboutRoutes);
app.use("/api/expertise", expertiseRoutes);
app.use("/api/process", processRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/case-study", caseStudyRoutes);
app.use("/api/faq", faqRoutes);
app.use("/api/hero-left", heroLeftRoutes);
app.use("/api/universities", universitiesRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/fees", feesRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/batches", batchesRoutes);
app.use("/api/activity-logs", activityLogRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/reports", reportsRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/backup", backupRoutes);
app.use("/api/faculties", facultyRoutes);
app.use("/api/staff", staffRoutes);
app.use("/api/finance", financeRouter);
app.use("/api/accounting", accountingRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/income", incomeRouter);
app.use("/api/salary-structures", salaryRouter);
app.use("/api/employee-advances", advancesRouter);
app.use("/api/employee-loans", loansRouter);
app.use("/api/payroll", payrollRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/question-bank", questionBankRoutes);
app.use("/api/exams", examsRoutes);
app.use("/api/student/exams", studentExamsRoutes);
app.use("/api/assignments", assignmentsRoutes);

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Not found",
    method: req.method,
    path: req.originalUrl || req.url,
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, message: "Internal server error" });
});

async function runSeeds() {
  await seedMasterAdminUser();
  await seedEnquiriesDemo();
  await seedLeadsDemo();
  await seedSiteSettingsDemo();
  await seedAboutDemo();
  await seedExpertiseDemo();
  await seedProcessDemo();
  await seedServicesDemo();
  await seedCaseStudyDemo();
  await seedFaqDemo();
  await seedHeroLeftDemo();
  await seedUniversitiesDemo();
  await seedCoursesDemo();
  await seedBatchesAndAttendance();
  await seedStaffLookups();
  await seedStaffDemo();
  console.log("Demo seeds finished");
}

function afterMongoConnected() {
  if (process.env.SEED_ON_START === "1") {
    runSeeds().catch((err) => {
      console.error("Background seed failed:", err?.message || err);
    });
  } else {
    seedMasterAdminUser().catch((err) => {
      console.error("Master-admin seed failed:", err?.message || err);
    });
  }
}

function listenOnce(server) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off("listening", onListening);
      reject(err);
    };

    const onListening = () => {
      server.off("error", onError);
      console.log(`Server listening on http://localhost:${env.port}`);
      console.log(`Socket.IO ready for live section logs`);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(env.port);
  });
}

async function listen(server) {
  const retries = 15;
  for (let i = 1; i <= retries; i += 1) {
    try {
      await listenOnce(server);
      return;
    } catch (err) {
      const busy = err?.code === "EADDRINUSE";
      if (!busy) throw err;
      if (i === retries) {
        throw new Error(
          `Port ${env.port} is already in use. Close the extra terminal running tns-server, then try again.`
        );
      }
      console.warn(
        `Port ${env.port} still busy (old process closing). Retry ${i}/${retries}...`
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

async function shutdown(server, signal) {
  console.log(`Shutting down (${signal})...`);
  try {
    await new Promise((resolve) => {
      server.close(() => resolve());
      setTimeout(resolve, 800);
    });
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  } catch {
    // ignore — watch mode will kill the process anyway
  }
  process.exit(0);
}

async function startLocal() {
  const server = http.createServer(app);
  initSocket(server);

  process.once("SIGINT", () => void shutdown(server, "SIGINT"));
  process.once("SIGTERM", () => void shutdown(server, "SIGTERM"));

  console.log("Booting API...");
  await listen(server);
  await connectMongoOnce();
  afterMongoConnected();
}

async function startServerless() {
  console.log("Booting API (Vercel)...");
  connectMongoOnce()
    .then(() => afterMongoConnected())
    .catch((err) => {
      console.error("MongoDB connect failed:", err?.message || err);
    });
}

if (isVercel) {
  startServerless();
} else {
  startLocal().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}

export default app;
