import mongoose from "mongoose";
import { connectMongo } from "../db/connectMongo.js";
import { seedMasterAdminUser } from "../db/seedMasterAdminUser.js";
import { seedEnquiriesDemo } from "../db/seedEnquiriesDemo.js";
import { seedSiteSettingsDemo } from "../db/seedSiteSettingsDemo.js";
import { seedAboutDemo } from "../db/seedAboutDemo.js";
import { seedExpertiseDemo } from "../db/seedExpertiseDemo.js";
import { seedProcessDemo } from "../db/seedProcessDemo.js";
import { seedServicesDemo } from "../db/seedServicesDemo.js";
import { seedCaseStudyDemo } from "../db/seedCaseStudyDemo.js";
import { seedFaqDemo } from "../db/seedFaqDemo.js";
import { seedHeroLeftDemo } from "../db/seedHeroLeftDemo.js";
import { seedUniversitiesDemo } from "../db/seedUniversitiesDemo.js";
import { seedCoursesDemo } from "../db/seedCoursesDemo.js";
import { seedQuestionBankOmcComputerBasic } from "../db/seedQuestionBankOmcComputerBasic.js";
import { seedStaffDemo } from "../db/seedStaffDemo.js";

async function runAllSeeds() {
  await connectMongo();

  console.log("Running all seeds (upsert mode)...\n");

  await seedMasterAdminUser();
  await seedEnquiriesDemo();
  await seedSiteSettingsDemo({ upsert: true });
  await seedAboutDemo({ upsert: true });
  await seedExpertiseDemo({ upsert: true });
  await seedProcessDemo({ upsert: true });
  await seedServicesDemo({ upsert: true });
  await seedCaseStudyDemo({ upsert: true });
  await seedFaqDemo({ upsert: true });
  await seedHeroLeftDemo({ upsert: true });
  await seedUniversitiesDemo();
  await seedCoursesDemo();
  await seedQuestionBankOmcComputerBasic();
  await seedStaffDemo();

  console.log("\nAll seeds completed.");
  await mongoose.disconnect();
}

runAllSeeds().catch((err) => {
  console.error("Seed run failed:", err);
  mongoose.disconnect().finally(() => process.exit(1));
});
