import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { uploadFile, deleteFile } from "@/lib/storage";
import { rateLimit } from "@/lib/rate-limiter";
import { verifySessionRole } from "@/lib/auth-guards";

export async function GET() {
  const results: { [key: string]: string } = {
    prisma: "Failed",
    storage: "Failed",
    rateLimiter: "Failed",
    authGuards: "Failed",
  };

  // 1. Test Auth Guards compilation and behavior (should return unauthorized without session)
  try {
    const authCheck = await verifySessionRole();
    if (authCheck.authorized === false && authCheck.response instanceof NextResponse) {
      results.authGuards = "Pass (Correctly returned Unauthorized response)";
    } else {
      results.authGuards = `Fail (Unexpected return: ${JSON.stringify(authCheck)})`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.authGuards = `Fail: ${message}`;
  }

  // 2. Test File Storage locally
  try {
    const testBuffer = Buffer.from("ImpactBridge Verification Test File Content");
    const testName = "verification-receipt.txt";
    const testFolder = "tests";
    
    // Upload
    const fileUrl = await uploadFile(testBuffer, testName, testFolder);
    
    if (fileUrl.startsWith("/uploads/tests/")) {
      // Delete
      await deleteFile(fileUrl);
      results.storage = `Pass (Uploaded to relative URL: ${fileUrl} and deleted successfully)`;
    } else {
      results.storage = `Fail: Unexpected file URL: ${fileUrl}`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.storage = `Fail: ${message}`;
  }

  // 3. Test Rate Limiter (mock IP "127.0.0.9", route "/api/test", window 60s, max 3)
  try {
    const ip = "127.0.0.9";
    const route = "/api/test-route";
    
    // Attempt 1: Should pass
    const r1 = await rateLimit(ip, route, 3, 60);
    // Attempt 2: Should pass
    const r2 = await rateLimit(ip, route, 3, 60);
    // Attempt 3: Should pass
    const r3 = await rateLimit(ip, route, 3, 60);
    // Attempt 4: Should fail
    const r4 = await rateLimit(ip, route, 3, 60);

    if (r1.success && r2.success && r3.success && !r4.success) {
      results.rateLimiter = "Pass (Correctly allowed 3 requests and blocked the 4th request)";
    } else {
      results.rateLimiter = `Fail (Attempt status - R1: ${r1.success}, R2: ${r2.success}, R3: ${r3.success}, R4: ${r4.success})`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.rateLimiter = `Fail: ${message}`;
  }

  // 4. Test Prisma Connection
  // Note: Database operations will fail if there is no active postgres server running locally,
  // but if the rate-limiter test above succeeded, it means Prisma successfully ran queries!
  // Let's check if we can query the RateLimitLog table.
  try {
    const count = await prisma.rateLimitLog.count();
    results.prisma = `Pass (Connected successfully, RateLimitLog record count: ${count})`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.prisma = `Fail: ${message}`;
  }

  const overallPass = 
    results.authGuards.startsWith("Pass") &&
    results.storage.startsWith("Pass") &&
    results.rateLimiter.startsWith("Pass") &&
    results.prisma.startsWith("Pass");

  return NextResponse.json(
    {
      status: overallPass ? "PASS" : "FAIL",
      results,
    },
    { status: overallPass ? 200 : 500 }
  );
}
