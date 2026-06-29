import assert from "node:assert/strict";
import { redactText } from "../shared/redaction.mjs";

const cases = [];

for (let i = 1; i <= 30; i += 1) {
  cases.push({
    name: `email-${i}`,
    input: `Please contact user${i}@example.com about the upload.`,
    forbidden: [`user${i}@example.com`],
    required: ["[EMAIL]"]
  });
}

for (let i = 100; i < 130; i += 1) {
  cases.push({
    name: `phone-${i}`,
    input: `My phone number is 312-555-${String(i).padStart(4, "0")}.`,
    forbidden: [`312-555-${String(i).padStart(4, "0")}`],
    required: ["[PHONE]"]
  });
}

for (let i = 10; i < 30; i += 1) {
  cases.push({
    name: `ssn-${i}`,
    input: `The test SSN is 123-45-${String(6700 + i)} for validation only.`,
    forbidden: [`123-45-${String(6700 + i)}`],
    required: ["[SSN]"]
  });
}

for (let i = 0; i < 20; i += 1) {
  cases.push({
    name: `card-${i}`,
    input: `The temporary card is 4111 1111 1111 ${String(1000 + i)}.`,
    forbidden: [`4111 1111 1111 ${String(1000 + i)}`],
    required: ["[CREDIT_CARD]"]
  });
}

const names = ["Rujuta", "Priya", "Asha", "Maya", "Neha", "Ananya", "Rahul", "Amit", "Barry", "John"];
for (const name of names) {
  cases.push({
    name: `self-intro-${name}`,
    input: `Hello, my name is ${name}. I like reading and movies.`,
    forbidden: [`my name is ${name}`],
    required: ["my name is [NAME]"]
  });
}

const profanity = ["damn", "hell", "shit", "fuck", "bitch", "asshole"];
for (const word of profanity) {
  cases.push({
    name: `profanity-${word}`,
    input: `This is a ${word} test case.`,
    forbidden: [word],
    required: ["[PROFANITY]"]
  });
}

cases.push(
  {
    name: "mixed-email-phone-name",
    input: "Hello, my name is Rujuta. Email me at rujuta@example.com or call 312-555-8888.",
    forbidden: ["my name is Rujuta", "rujuta@example.com", "312-555-8888"],
    required: ["my name is [NAME]", "[EMAIL]", "[PHONE]"]
  },
  {
    name: "clean-text",
    input: "The speaker likes books, movies, and honey bees.",
    forbidden: [],
    required: ["books", "movies"]
  },
  {
    name: "ip-address",
    input: "The debug IP was 192.168.1.10 during testing.",
    forbidden: ["192.168.1.10"],
    required: ["[IP_ADDRESS]"]
  },
  {
    name: "multi-sensitive",
    input: "I am Priya and my SSN is 123-45-6789 and email is priya@test.com.",
    forbidden: ["I am Priya", "123-45-6789", "priya@test.com"],
    required: ["I am [NAME]", "[SSN]", "[EMAIL]"]
  }
);

let passed = 0;
for (const testCase of cases) {
  const { redactedText, redactionLog } = redactText(testCase.input);

  for (const forbidden of testCase.forbidden) {
    assert.equal(
      redactedText.includes(forbidden),
      false,
      `${testCase.name}: forbidden value still present: ${forbidden}\nOutput: ${redactedText}`
    );
  }

  for (const required of testCase.required) {
    assert.equal(
      redactedText.includes(required),
      true,
      `${testCase.name}: required value missing: ${required}\nOutput: ${redactedText}`
    );
  }

  assert.ok(Array.isArray(redactionLog), `${testCase.name}: redactionLog must be an array`);
  passed += 1;
}

assert.ok(cases.length >= 120, `Expected at least 120 cases, got ${cases.length}`);
console.log(`Redaction validation passed: ${passed}/${cases.length} seeded cases`);
