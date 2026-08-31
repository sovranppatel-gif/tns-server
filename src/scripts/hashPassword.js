import bcrypt from "bcryptjs";

const pwd = process.argv[2];
if (!pwd) {
  console.error('Usage: npm run hash-password -- "your-password"');
  process.exit(1);
}

console.log(bcrypt.hashSync(pwd, 10));
