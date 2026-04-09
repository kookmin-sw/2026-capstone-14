require("dotenv").config();
const express = require("express");
const expressLayouts = require("express-ejs-layouts");
const cookieParser = require("cookie-parser");
const { addAuthState } = require("./middleware/auth");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();
const PORT = process.env.PORT || 3000;

// 레이아웃 및 뷰 엔진 설정
app.use(expressLayouts);
app.set('view engine', 'ejs');
app.set("views", __dirname + "/views");
app.use(express.static("public"));
app.set('layout', 'layouts/main'); // 기본 레이아웃 설정

// 미들웨어 설정
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());

// 인증 상태(UI용)를 모든 뷰에 전달
app.use(addAuthState);

// 라우트 설정
app.use("/", require("./routes/main"));
app.use("/", require("./routes/workout"));
app.use("/admin", require("./routes/admin"));

// 전역 에러 핸들러
app.use(notFound); // 404
app.use(errorHandler);

// 서버 시작
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});