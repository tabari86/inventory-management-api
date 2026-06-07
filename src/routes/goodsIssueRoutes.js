const express = require("express");

const {
  createGoodsIssue,
} = require("../controllers/goodsIssueController");

const router = express.Router();

router.post("/", createGoodsIssue);

module.exports = router;