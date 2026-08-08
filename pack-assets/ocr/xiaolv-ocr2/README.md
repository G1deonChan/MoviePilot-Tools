---
backbone:
- convNext-Tiny
integrating: True
domain:
- cv
frameworks:
- pytorch
language:
- en
- zh
license: Apache License 2.0
metrics:
- Line Accuracy
tags:
- OCR
- Alibaba
- 文字识别
- 读光
tasks:
- ocr-recognition

studios:
- xiaolv/ocr


widgets:
  - task: ocr-recognition
    inputs:
      - type: image
    examples:
      - name: 1
        inputs:
          - name: image
            data: http://duguang-labelling.oss-cn-shanghai.aliyuncs.com/mass_img_tmp_20220922/ocr_recognition.jpg
base_model_relation: finetune
base_model:
  - iic/cv_convnextTiny_ocr-recognition-general_damo
---
## 介绍（Introduction）

**验证码识别模型  ocr-captcha**专门识别常见验证码的模型，训练模型有3个：
  
  1.**[ocr_small](https://modelscope.cn/models/xiaolv/ocr_small/summary)**:训练数据大小为700MB，约8.4万张验证码图片，训练轮次27轮，最终的精度将近100%，推荐下载这个模型；
  
  2.**[ocr_big](https://modelscope.cn/models/xiaolv/ocr_big/summary)**:训练数据大小为11G，约135万个验证码图片，训练轮次1轮，最终的精度将近93.95%(由于资源问题，无法训练太久)；

  3.🚀 **[2025-11-20]** **[ocr2](https://modelscope.cn/models/xiaolv/ocr2/summary)**:训练数据大小为3G，约60万个验证码图片，训练轮次30轮，最终的精度将近`{"accuracy": 0.988, "AR": 0.998}`；版本号为：`model_revision='v1.0.1'`


## 数据分布

  1.**类型**：`1` 纯数字（`0-9`）；`2` 数字+字母（`0-9 + a-z + A-Z`）；`3` 纯字母（`a-z + A-Z`）；`4` 手机号（11 位随机数字）；`5` 邮箱（本地部分使用 `a-zA-Z0-9`，域名来自常见集合；渲染与标签均去掉 `.`，保留 `@`）；`6` 区号电话（区号与主号随机数字，格式可能包含括号或连字符，分机号可选）
  
  2.**长度**：2-8位

## 数据微调

  1.**基座模型**：基座模型参考达摩院发布的[读光-文字识别-行识别模型-中英-通用领域](https://www.modelscope.cn/models/damo/cv_convnextTiny_ocr-recognition-general_damo/summary)
  
  2.**具体微调参考以上链接**

## 模型体验链接

modelscope：[验证码识别模型（ocr-captcha）](https://modelscope.cn/studios/xiaolv/ocr/summary)


## 模型能力
通过新的数据与训练策略，模型具备以下能力与改进：
1. 正确识别数字 `0`，不再将 `0` 误判为字母 `O`
2. 对适度干扰线条、噪点与背景浅色线条具备鲁棒性
3. 文本统一居中绘制、无旋转，训练与推理一致性更好
4. 支持 6 类目标文本（含手机号、邮箱、区号电话）；邮箱渲染与标签去点号
5. 提供随机与单色文本颜色两种模式，默认暗色随机色提升泛化



## 快速使用（Quickstart）

代码提供web网页版：```myself_train_model.py```

详细数据参考huggingface代码：[xiaolv/ocr-captcha](https://huggingface.co/xiaolv/ocr-captcha)

```python
from modelscope.pipelines import pipeline
from modelscope.utils.constant import Tasks
import gradio as gr
import os


class xiaolv_ocr_model():

    def __init__(self):
        model_small = r"./output_small"
        model_big = r"./output_big"
        self.ocr_recognition_small = pipeline(Tasks.ocr_recognition, model=model_small)
        self.ocr_recognition1_big = pipeline(Tasks.ocr_recognition, model=model_big)


    def run(self,pict_path,moshi = "small", context=[]):
        pict_path = pict_path.name
        context = [pict_path]

        if moshi == "small":
            result = self.ocr_recognition_small(pict_path)
        else:
            result = self.ocr_recognition1_big(pict_path)

        context += [str(result['text'][0])]
        responses = [(u, b) for u, b in zip(context[::2], context[1::2])]
        print(f"识别的结果为：{result}")
        os.remove(pict_path)
        return responses,context




if __name__ == "__main__":
    pict_path = r"C:\Users\admin\Desktop\图片识别测试\企业微信截图_16895911221007.png"
    ocr_model = xiaolv_ocr_model()
    # ocr_model.run(pict_path)
```


## 快速使用gradio
```python
import os
os.system('pip install "modelscope==1.8.0" -f https://pypi.org/project/modelscope/')


from modelscope.pipelines import pipeline
from modelscope.utils.constant import Tasks
import gradio as gr

# os.system('pip install "modelscope[cv]" -f https://modelscope.oss-cn-beijing.aliyuncs.com/releases/repo.html')
# os.system('pip install "modelscope==1.8.0" -f -f https://pypi.org/project/modelscope/')
# os.system('pip install "modelscope" --upgrade -f https://pypi.org/project/modelscope/')



class xiaolv_ocr_model():

    def __init__(self):
        model_small = r"xiaolv/ocr_small"
        model_big = r"xiaolv/ocr_big"
        model_ocr2 = r"xiaolv/ocr2"
        self.ocr_recognition_small = pipeline(Tasks.ocr_recognition, model=model_small,model_revision='v1.0.0')
        self.ocr_recognition1_big = pipeline(Tasks.ocr_recognition, model=model_big,model_revision='v1.0.0')
        self.ocr_recognition_ocr2 = pipeline(Tasks.ocr_recognition, model=model_ocr2,model_revision='v1.0.1')

        self.ocr_dict = {
            "small":self.ocr_recognition_small ,
            "big": self.ocr_recognition1_big,
            "ocr2": self.ocr_recognition_ocr2,
        }


    def run(self,pict_path,moshi = "ocr2", context=[]):
        pict_path = pict_path.name
        context = [pict_path]
        print(f">>>> 使用模型：{moshi}")
        models_ocr = self.ocr_dict.get(moshi,"ocr2")

        result = models_ocr(pict_path)
        
        context += [str(result['text'][0])]
        responses = [(u, b) for u, b in zip(context[::2], context[1::2])]
        print(f">>>>>>> 识别的结果为：{result}")
        os.remove(pict_path)
        return responses,context




if __name__ == "__main__":

    ocr_model = xiaolv_ocr_model()

    with gr.Blocks() as demo:
        gr.HTML("""<h1 align="center">常见验证码识别——小吕</h1>""")
        with gr.Tab("验证码模型"):
            with gr.Accordion(open=False,label="说明文档"):
                gr.Markdown("""
                #### 专门识别常见验证码的模型，训练模型有2个：
                * 1.**small**:训练数据大小为700MB，约8.4万张验证码图片，训练轮次27轮，最终的精度将近100%；
                * 2.**big**:训练数据大小为11G，约135万个验证码图片，训练轮次1轮，最终的精度将近93.95%；
                3.🚀 **[2025-11-20]** **[ocr2]**:训练数据大小为3G，约60万个验证码图片，训练轮次30轮，最终的精度将近`{"accuracy": 0.98, "AR": 0.99}`；
                #### 训练验证码图片包括：
                * 类型：1. 纯数字型；2. 数字+字母型；3.纯字母型（大小写）
                * 长度：4位、5位、6位
                
                #### ocr2：新增能力：
                通过新的数据与训练策略，模型具备以下能力与改进：
                1. 正确识别数字 `0`，不再将 `0` 误判为字母 `O`
                2. 对适度干扰线条、噪点与背景浅色线条具备鲁棒性
                3. 文本统一居中绘制、无旋转，训练与推理一致性更好
                4. 支持 6 类目标文本（含手机号、邮箱、区号电话）；邮箱渲染与标签去点号
                5. 提供随机与单色文本颜色两种模式，默认暗色随机色提升泛化
    
                ### 可以使用API调用--点击底部 Use via API
                """)
            with gr.Row():
                with gr.Column():
                    select_types = gr.Radio(label="模型类型选择", choices=["ocr2","small", "big",], value="ocr2")
                    img_input = gr.File(label='输入图像,目前支持图片格式(png\jpg等)，建议使用png格式。',file_types=[".jpg",".jpeg",".png"])
                with gr.Column():
                    chatbot = gr.Chatbot([])
            with gr.Row():
                btn_submit = gr.Button(value="一键识别")

            state = gr.State([])

            btn_submit.click(fn=ocr_model.run, inputs=[img_input, select_types], outputs=[chatbot, state],api_name="xiaolv")

    demo.launch(show_error=True,share=True)
```








## 联系我们（Contact Us）

如果你想给我们的研发团队和产品团队留言，请通过邮件（2240560729@qq.com）联系我们。
