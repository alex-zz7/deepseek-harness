# 这个文件夹是知识库，不是普通项目

系统会先检索本库，并把命中段落放进问题里的 `<knowledge_context>`。
有这段资料就直接回答，不要调用 Bash、Skill、Read、Grep，也不要再调用 `mcp__kb__kb_search`。
`refuse="true"` 或没有可靠命中时，直说本库没有，不要改走同名 Skill。

引用只写文件名，例如 〔手册名.pdf〕。不要写出 file:// 或绝对路径，也不要打开 `index/chunks.jsonl` 或 `vectors.f32`。
