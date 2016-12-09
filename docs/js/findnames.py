import glob,os


def fileNames(docFile,folder):
	docString="var "+folder+"=["
	for file in glob.glob("../doc/"+folder+"/*.html"):

		docString+='"'+file.replace(".html","").split("/")[-1]+'",'
	
	docString=docString[:-1]
	docString+="]"
	docFile.write(docString+"\n")


docFile=open("docs.js","w")
fileNames(docFile,"documentation")
fileNames(docFile,"tutorials")

docFile.close()
