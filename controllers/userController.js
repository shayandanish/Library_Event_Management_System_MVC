// controllers/userController.js
const User = require("../models/User");
const { generateMemberID } = require("../utils/idGen");

const isPhone = (s) => /^(\+?\d[\d\s-]{6,})$/.test(s || "");
const isEmail = (s) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((s || "").toLowerCase());

exports.renderAddForm = async (req, res) => {
  res.render("members/addMember", { msg: req.query.msg || "" });
};

exports.createMember = async (req, res, next) => {
  try {
    const { fullName, phone, email, memberType, gender } = req.body;

    // Basic validations
    if (!fullName?.trim()) {
      return res.redirect(
        "/members/add?msg=" + encodeURIComponent("Name is required")
      );
    }
    if (phone && !isPhone(phone)) {
      return res.redirect(
        "/members/add?msg=" + encodeURIComponent("Invalid phone number")
      );
    }
    if (email && !isEmail(email)) {
      return res.redirect(
        "/members/add?msg=" + encodeURIComponent("Invalid email")
      );
    }
    const allowedTypes = ["student", "teacher", "staff", "foreigner"];
    const allowedGender = ["male", "female", "other"];
    if (!allowedTypes.includes(memberType)) {
      return res.redirect(
        "/members/add?msg=" + encodeURIComponent("Invalid member type")
      );
    }
    if (!allowedGender.includes(gender)) {
      return res.redirect(
        "/members/add?msg=" + encodeURIComponent("Invalid gender")
      );
    }

    const memberID = await generateMemberID();

    const doc = await User.create({
      memberID,
      fullName: fullName.trim(),
      phone: phone?.trim(),
      email: email?.trim().toLowerCase(),
      memberType,
      gender,
    });

    return res.redirect(
      "/members/add?msg=" +
        encodeURIComponent(`Member added: ${doc.fullName} (${doc.memberID})`)
    );
  } catch (err) {
    if (err?.code === 11000) {
      return res.redirect(
        "/members/add?msg=" + encodeURIComponent("Duplicate memberID/email")
      );
    }
    next(err);
  }
};

// For populating dropdowns/search
exports.listUsers = async (req, res, next) => {
  try {
    const q = (req.query.q || "").trim();
    const type = (req.query.type || "").trim().toLowerCase();
    const gender = (req.query.gender || "").trim().toLowerCase();

    const filter = {};
    if (q) {
      filter.$or = [
        { fullName: new RegExp(q, "i") },
        { memberID: new RegExp(q, "i") },
        { email: new RegExp(q, "i") },
        { phone: new RegExp(q, "i") },
      ];
    }
    if (["student", "teacher", "staff", "foreigner"].includes(type))
      filter.memberType = type;
    if (["male", "female", "other"].includes(gender)) filter.gender = gender;

    const users = await User.find(filter).sort({ fullName: 1 }).limit(200);
    res.json(users);
  } catch (e) {
    next(e);
  }
};


/** Render HTML list of registered members */
exports.renderList = async (req, res, next) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.render("members/list", { users });
  } catch (e) {
    next(e);
  }
};
