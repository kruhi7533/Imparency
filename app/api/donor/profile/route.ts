import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { DonorPersona } from "@prisma/client";

export async function PUT(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "DONOR") {
      return NextResponse.json({ error: "Only donors can update donor profiles" }, { status: 403 });
    }

    const body = await request.json();
    const {
      name,
      phone,
      city,
      billingAddress,
      panNumber,
      isCorporate,
      companyName,
      gstNumber,
      donorPersona,
      hniAdvisorName,
      hniAdvisorEmail,
      hniAnnualBudget,
      csrRegistrationNumber,
      csrBudget,
      trustRegistrationId,
      trust12a80gRegNo,
      trustAnnualBudget,
    } = body;

    // Validate name
    if (!name || name.trim() === "") {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Validate donor persona if provided
    let verifiedPersona: DonorPersona | null = null;
    if (donorPersona) {
      if (Object.values(DonorPersona).includes(donorPersona as DonorPersona)) {
        verifiedPersona = donorPersona as DonorPersona;
      }
    }

    // Update user profile in database
    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        name: name.trim(),
        phone: phone ? phone.trim() : null,
        city: city ? city.trim() : null,
        billingAddress: billingAddress ? billingAddress.trim() : null,
        panNumber: panNumber ? panNumber.trim() : null,
        isCorporate: !!isCorporate,
        companyName: isCorporate && companyName ? companyName.trim() : null,
        gstNumber: isCorporate && gstNumber ? gstNumber.trim() : null,
        donorPersona: verifiedPersona,
        hniAdvisorName: hniAdvisorName ? hniAdvisorName.trim() : null,
        hniAdvisorEmail: hniAdvisorEmail ? hniAdvisorEmail.trim() : null,
        hniAnnualBudget: hniAnnualBudget != null && hniAnnualBudget !== "" ? Number(hniAnnualBudget) : null,
        csrRegistrationNumber: csrRegistrationNumber ? csrRegistrationNumber.trim() : null,
        csrBudget: csrBudget != null && csrBudget !== "" ? Number(csrBudget) : null,
        trustRegistrationId: trustRegistrationId ? trustRegistrationId.trim() : null,
        trust12a80gRegNo: trust12a80gRegNo ? trust12a80gRegNo.trim() : null,
        trustAnnualBudget: trustAnnualBudget != null && trustAnnualBudget !== "" ? Number(trustAnnualBudget) : null,
      },
    });

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        phone: updatedUser.phone,
        city: updatedUser.city,
        billingAddress: updatedUser.billingAddress,
        panNumber: updatedUser.panNumber,
        isCorporate: updatedUser.isCorporate,
        companyName: updatedUser.companyName,
        gstNumber: updatedUser.gstNumber,
        donorPersona: updatedUser.donorPersona,
        hniAdvisorName: updatedUser.hniAdvisorName,
        hniAdvisorEmail: updatedUser.hniAdvisorEmail,
        hniAnnualBudget: updatedUser.hniAnnualBudget ? Number(updatedUser.hniAnnualBudget) : null,
        csrRegistrationNumber: updatedUser.csrRegistrationNumber,
        csrBudget: updatedUser.csrBudget ? Number(updatedUser.csrBudget) : null,
        trustRegistrationId: updatedUser.trustRegistrationId,
        trust12a80gRegNo: updatedUser.trust12a80gRegNo,
        trustAnnualBudget: updatedUser.trustAnnualBudget ? Number(updatedUser.trustAnnualBudget) : null,
      },
    });
  } catch (error: any) {
    console.error("Donor profile update error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to update profile" },
      { status: 500 }
    );
  }
}
